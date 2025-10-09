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
				polyLayer;
	
		/* Starts the polygon drawing mode
		 * Initializes the needed components on the map
		 */
		this.startPolyMode = function () { // XXX misleading function name
			if (state === "draw") return;
	
			// End edit mode
			if (state === "edit") {
				editor.disable();
				state = "editend";
				
				var selectedData = layerManager.selectedData();
	
				$('#new-feature-name').val(selectedData.properties.name);
				$('#new-feature-type').val(selectedData.properties.type);
				$('#new-feature-link').val(selectedData.properties.link);
	
				$('#new-feature').modal('show');
				$('.layers-select').val( layerManager.mostRecentlyEnabled() );
				$('.features-select').trigger('change');
				$('#drawmode').removeClass('active');
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