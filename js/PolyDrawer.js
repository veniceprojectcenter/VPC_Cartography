define(['jquery', 'Leaflet', 'LeafletDraw'], function($, L) {
	"use strict";
	
	/* Holds code for drawing new polygon features on the map
	 */
	function PolyDrawer(mapManager, layerManager, dataService) {
		var points = [],
				markers = [],
				newPoly = null,
				state = "start",
				editor,
				polyLayer,
				originalLatLngs = null;

		// Improve edit handle visibility and interaction semantics.
		var existingVertexIcon = new L.DivIcon({
			iconSize: new L.Point(10, 10),
			className: 'leaflet-div-icon leaflet-editing-icon leaflet-existing-vertex'
		});
		var middleVertexIcon = new L.DivIcon({
			iconSize: new L.Point(10, 10),
			className: 'leaflet-div-icon leaflet-editing-icon leaflet-middle-vertex'
		});

		if (L.Edit && L.Edit.Poly && !L.Edit.Poly.prototype._vpcCartoPatched) {
			// Use visible icons for existing vertices.
			L.Edit.Poly.prototype.options.icon = existingVertexIcon;

			// Only delete vertices when shift-clicking to avoid collisions with add handles.
			var originalOnMarkerClick = L.Edit.Poly.prototype._onMarkerClick;
			L.Edit.Poly.prototype._onMarkerClick = function (evt) {
				if (!(evt && evt.originalEvent && evt.originalEvent.shiftKey)) {
					return;
				}
				return originalOnMarkerClick.call(this, evt);
			};

			// Allow different icons/z-index for middle markers vs. existing vertices.
			L.Edit.Poly.prototype._createMarker = function (latlng, index, icon, zIndexOffset) {
				var marker = new L.Marker(latlng, {
					draggable: true,
					icon: icon || existingVertexIcon,
					zIndexOffset: zIndexOffset || 100
				});
				marker._origLatLng = latlng;
				marker._index = index;
				marker.on("drag", this._onMarkerDrag, this);
				marker.on("dragend", this._fireEdit, this);
				this._markerGroup.addLayer(marker);
				return marker;
			};

			L.Edit.Poly.prototype._createMiddleMarker = function (left, right) {
				var middleLatLng = this._getMiddleLatLng(left, right);
				var middleMarker = this._createMarker(middleLatLng, null, middleVertexIcon, -200);
				middleMarker.setOpacity(0.9);
				left._middleRight = right._middleLeft = middleMarker;

				var convertToVertex = function () {
					var newIndex = right._index;
					middleMarker._index = newIndex;
					middleMarker.off("click", addVertex, this).on("click", this._onMarkerClick, this);
					middleLatLng.lat = middleMarker.getLatLng().lat;
					middleLatLng.lng = middleMarker.getLatLng().lng;
					this._poly.spliceLatLngs(newIndex, 0, middleLatLng);
					this._markers.splice(newIndex, 0, middleMarker);
					middleMarker.setIcon(existingVertexIcon);
					middleMarker.setZIndexOffset(100);
					middleMarker.setOpacity(1);
					this._updateIndexes(newIndex, 1);
					right._index++;
					this._updatePrevNext(left, middleMarker);
					this._updatePrevNext(middleMarker, right);
				};

				var splitIntoNewMiddles = function () {
					middleMarker.off("dragstart", convertToVertex, this);
					middleMarker.off("dragend", splitIntoNewMiddles, this);
					this._createMiddleMarker(left, middleMarker);
					this._createMiddleMarker(middleMarker, right);
				};

				var addVertex = function (evt) {
					if (evt && evt.originalEvent && evt.originalEvent.shiftKey) {
						return;
					}
					convertToVertex.call(this);
					splitIntoNewMiddles.call(this);
					this._fireEdit();
				};

				middleMarker
					.on("click", addVertex, this)
					.on("dragstart", convertToVertex, this)
					.on("dragend", splitIntoNewMiddles, this);

				this._markerGroup.addLayer(middleMarker);
			};

			L.Edit.Poly.prototype._vpcCartoPatched = true;
		}

		if (L.Draw && L.Draw.Polyline && !L.Draw.Polyline.prototype._vpcCartoBackspacePatched) {
			var originalPolylineCancel = L.Draw.Polyline.prototype._cancelDrawing || L.Draw.Feature.prototype._cancelDrawing;
			L.Draw.Polyline.prototype._recalculateRunningTotal = function () {
				var total = 0;
				for (var i = 1; i < this._markers.length; i++) {
					total += this._markers[i - 1].getLatLng().distanceTo(this._markers[i].getLatLng());
				}
				this._measurementRunningTotal = total;
			};
			L.Draw.Polyline.prototype._undoLastVertex = function () {
				if (!this._markers || this._markers.length === 0) {
					return;
				}
				var marker = this._markers.pop();
				marker.off("click", this._finishShape, this);
				marker.off("dblclick", this._finishShape, this);
				this._markerGroup.removeLayer(marker);
				var latlngs = this._poly.getLatLngs();
				if (latlngs.length > 0) {
					this._poly.spliceLatLngs(latlngs.length - 1, 1);
				}
				if (this._poly.getLatLngs().length < 2 && this._map.hasLayer(this._poly)) {
					this._map.removeLayer(this._poly);
				}
				this._recalculateRunningTotal();
				this._updateFinishHandler();
				this._clearGuides();
				this._updateTooltip();
			};
			L.Draw.Polyline.prototype._cancelDrawing = function (evt) {
				var keyCode = evt && (evt.keyCode || evt.which);
				if (keyCode === 8) {
					var target = evt.target || evt.srcElement;
					var tagName = target && target.tagName ? target.tagName.toLowerCase() : "";
					var isEditable = target && (target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select");
					if (!isEditable) {
						L.DomEvent.preventDefault(evt);
						L.DomEvent.stopPropagation(evt);
						this._undoLastVertex();
						return;
					}
				}
				return originalPolylineCancel.call(this, evt);
			};
			L.Draw.Polyline.prototype._vpcCartoBackspacePatched = true;
		}
		function cloneLatLngs(latlngs) {
			if (!latlngs || !latlngs.map) return null;
			return latlngs.map(function(ring) {
				if (!Array.isArray(ring)) {
					return L.latLng(ring.lat, ring.lng);
				}
				return ring.map(function(point) {
					if (point && point.lat !== undefined && point.lng !== undefined) {
						return L.latLng(point.lat, point.lng);
					}
					if (Array.isArray(point) && point.length >= 2) {
						return L.latLng(point[0], point[1]);
					}
					return point;
				});
			});
		}

		function finishEditCleanup() {
			state = "start";
			editor = null;
			originalLatLngs = null;
			polyLayer = null;
			$('#drawmode').removeClass('active');
		}

		function rollbackEditedGeometry() {
			if (polyLayer && originalLatLngs) {
				polyLayer.setLatLngs(originalLatLngs);
				polyLayer.redraw();
			}
			mapManager.map.closePopup();
		}

		function saveEditedGeometry() {
			var feature = layerManager.selectedData();
			if (!feature || !polyLayer || !dataService.fbAuth2 || !dataService.fbAuth2.ref) {
				return;
			}
			var geometry = polyLayer.toGeoJSON().geometry;
			var geometryRef = dataService.fbAuth2.ref('cartography/geometries/' + dataService.currentMap() + '/' + feature.id);

			dataService.fbAuth2.set(geometryRef, geometry)
				.then(function(){
					feature.geometry = geometry;
					var layerId = feature.properties.type;
					var enabledLayers = layerManager.getEnabledLayers && layerManager.getEnabledLayers();
					var layerIsEnabled = enabledLayers && enabledLayers.indexOf(layerId) !== -1;
					if (layerIsEnabled) {
						layerManager.disableLayer(layerId);
						layerManager.enableLayer(layerId, undefined, feature.id);
					}
					mapManager.map.closePopup();
				})
				.catch(function(error){
					alert("Error: " + error);
				});
		}
	
		/* Starts the polygon drawing mode
		 * Initializes the needed components on the map
		 */
		this.startPolyMode = function () { // XXX misleading function name
			if (state === "draw") return;
	
			// End edit mode
			if (state === "edit") {
				editor.disable();
				var saveChanges = window.confirm("Save changes to this polygon?");

				if (saveChanges) {
					saveEditedGeometry();
				} else {
					rollbackEditedGeometry();
				}

				finishEditCleanup();
				return;
			}
	
			// XXX HACK ALERT
			// Check if a feature is selected. This will unselect it.
			var layerCount = Object.keys(mapManager.map._layers).length;
			mapManager.map.closePopup();
			var newLayerCount = Object.keys(mapManager.map._layers).length;
			var objectSelected = layerCount > newLayerCount;
	
			if(objectSelected) { // If an object is selected, edit it
				// selectedPoly in the poly click handler
				polyLayer = layerManager.selectedPoly();
				if (!polyLayer || !polyLayer.getLatLngs) return;
				originalLatLngs = cloneLatLngs(polyLayer.getLatLngs());
				editor = new L.Edit.Poly(polyLayer);
				editor.enable();
				state = "edit";
			} else { // Draw a new polygon
				mapManager.map.once('draw:created', function (e) {
					polyLayer = e.layer;
					$('#new-feature').modal('show');
					$('.layers-select').val( layerManager.mostRecentlyEnabled() );
					$('.features-select').trigger('change');
					$('#drawmode').removeClass('active');
					state = "start";
				});
	
				// Start the Leaflet.Draw plugin
				var circleIcon = new L.Icon({
					iconUrl: "img/circle.png",
					iconSize: [8,8]
				});
				new L.Draw.Polygon(mapManager.map, {icon: circleIcon}).enable();
				state = "draw";
			}
	
			// Update button style
			$('#drawmode').addClass('active');
		};
	
		/* When the feautre is ready to be submitted,
		 * call this, and we pull information from the modal
		 * and use it to populate the database.
		 */
		/* When the feautre is ready to be submitted,
 * call this, and we pull information from the modal
 * and use it to populate the database.
 */
		this.submitFeature = function () {
			var name = $('#new-feature-name').val();
			var type = $('#new-feature-type').val();
			var link = $('#new-feature-link').val();
			var code = $('#feature-code').val(); // ← New field

			// If the feature already exists, update it         
			var feature;
			var geometry;
			if (state === "editend") {
				feature = layerManager.selectedData();
				state = "start";
			} else {
				feature = dataService.findData(name);
			}
			
			// Case A: Adding Coordinates to an Existing Feature (via 'create-coordinates' active state)
			if ($('#create-coordinates').hasClass('active')) {
				var featureId = $('#old-feature').val();
				feature = dataService.featureById(featureId);
				
				if (feature.properties.maps.indexOf(dataService.currentMap()) === -1) {
					feature.properties.maps.push(dataService.currentMap());
				} 

				// --- MIGRATION: 1. Add new geometry (Set) ---
				const geometryRef = dataService.fbAuth2.ref('cartography/geometries/' + dataService.currentMap() + '/' + featureId);
				dataService.fbAuth2.set(geometryRef, polyLayer.toGeoJSON().geometry);
				// --- END MIGRATION 1 ---

				// --- MIGRATION: 2. Update feature's map list (Set) ---
				const mapsRef = dataService.fbAuth2.ref('cartography/features/' + featureId + '/properties/maps');
				
				dataService.fbAuth2.set(mapsRef, feature.properties.maps)
					.then(function(){
						dataService.updateItem(feature);
						try {
							layerManager.disableLayer($('#feature-filter').val());
						} catch(err) { }
						layerManager.enableLayer($('#feature-filter').val());
					})
					.catch(function(error){
						return alert("Error: " + error);
					});
				// --- END MIGRATION 2 ---

			// Case B: Updating an Existing Feature's Data/Geometry
			} else if (feature) {
				if (!name) return;
				feature.properties.name = name;
				geometry = polyLayer.toGeoJSON().geometry;
				feature.properties.type = type;
				feature.properties.link = link;
				feature.properties.code = code; // ← New field
				
				// --- MIGRATION: 3. Update feature data (Set) ---
				const featureRef = dataService.fbAuth2.ref('cartography/features/' + feature.id);
				dataService.fbAuth2.set(featureRef, feature);
				// --- END MIGRATION 3 ---
				
				// --- MIGRATION: 4. Update geometry (Set) ---
				const geometryRef = dataService.fbAuth2.ref('cartography/geometries/' + dataService.currentMap() + '/' + feature.id);

				dataService.fbAuth2.set(geometryRef, geometry)
					.then(function(){
						dataService.updateItem(feature);
						try {
							layerManager.disableLayer(type);
						} catch(err) { }
						layerManager.enableLayer(type);
					})
					.catch(function(error){
						return alert("Error: " + error);
					});
				// --- END MIGRATION 4 ---

			// Case C: Creating a Brand New Feature
			} else {
				if (!name) return;
				var newFeature = {
					type: "Feature",
					properties: {
						name: name,
						type: type,
						link: link,
						code: code, // ← New field
						zoom: mapManager.map.getZoom(),
						maps: [dataService.currentMap()],
						center: {
							lat: polyLayer.getBounds().getCenter().lat,
							lng: polyLayer.getBounds().getCenter().lng
						}
					}
				};
				geometry = polyLayer.toGeoJSON().geometry;
				
				// --- MIGRATION: 5. Push new feature (Push + Set) ---
				const featuresListRef = dataService.fbAuth2.ref('cartography/features');
				const newFeatureRef = dataService.fbAuth2.push(featuresListRef);

				dataService.fbAuth2.set(newFeatureRef, newFeature)
					.then(function() {
						// Get the generated key from the new ref
						const featureId = newFeatureRef.key;
						
						// --- MIGRATION: 6. Set geometry using the new featureId (Set) ---
						const geometryRef = dataService.fbAuth2.ref('cartography/geometries/' + dataService.currentMap() + '/' + featureId);
						
						return dataService.fbAuth2.set(geometryRef, geometry)
							.then(function(){
								newFeature.id = featureId;
								dataService.push(newFeature);
								dataService.updateItem(newFeature);
								try {
									layerManager.disableLayer(type);
								} catch(err) { }
								layerManager.enableLayer(type);
							});
						// --- END MIGRATION 6 ---
					})
					.catch(function(error){
						return alert("Error: " + error);
					});
				// --- END MIGRATION 5 ---
			}

			$('#new-feature').modal('hide');
		};
	
		/* If the user chooses to discard the feature,
		 * we remove it from the database if it exists
		 */
		this.discardFeature = function () {
			if (state === "editend") { // If data exists (editing), delete it
				DATA.splice(DATA.indexOf(selectedData), 1);
				fb.child('vpc/features').set(DATA);
			}
	
			$('#new-feature').modal('hide');
		};
	}
	
	return PolyDrawer;
});
