define(['jquery', 'Leaflet', 'LeafletMiniMap'], function($, L) {
	
	function MapManager(dataService) {
		var self = this;
		var currentMapGeometries = {};
		var maps = {};
		var switchFunc = function() {};
		
		var mainLayer, miniMap;

		function markActiveMap(newMapId) {
			$('.map-menu-link').addClass('map-inactive').removeClass('map-active');
			if (newMapId) {
				$('#' + newMapId + '-map').removeClass('map-inactive').addClass('map-active');
			}
		}

		function insertMapMenuItem($menu, $item, year) {
			year = parseInt(year, 10) || 0;
			var inserted = false;
			$menu.children('li.map-menu-item').each(function() {
				var existingYear = parseInt($(this).data('mapYear'), 10) || 0;
				if (year < existingYear) {
					$(this).before($item);
					inserted = true;
					return false;
				}
			});

			if (!inserted) {
				var $newMapLink = $menu.children('#new-map-menu');
				if ($newMapLink.length) {
					$newMapLink.before($item);
				} else {
					$menu.append($item);
				}
			}
		}

		function ensureMapParentMenu(parentLabel) {
			var strippedParentName = parentLabel.replace(/\s/g, '');
			var $menu = $('#' + strippedParentName + '-menu');
			if ($menu.length) {
				return $menu;
			}
			var $group = $('<li>', { 'class': 'dropdown-submenu map-group' });
			var $title = $('<a>', { href: '#', text: parentLabel });
			$menu = $('<ul>', {
				id: strippedParentName + '-menu',
				'class': 'dropdown-menu'
			});
			$group.append($title).append($menu);

			var $newMapNode = $('#new-map-menu');
			if ($newMapNode.length) {
				$newMapNode.before($group);
			} else {
				$('.maps-menu').append($group);
			}

			var $parentSelect = $('#new-map-parent-other');
			if ($parentSelect.length) {
				$parentSelect.before('<option value="' + parentLabel + '">' + parentLabel + '</option>');
			}

			return $menu;
		}
		
		function shiftBounds (bounds) {
			return [[bounds[0][0], bounds[0][1] + 360], [bounds[1][0], bounds[1][1] + 360]];
		}
		
		this.mapLabel = function (mapId) {
			return '<b>'+maps[mapId].year+'</b>: '+maps[mapId].name;
		};
		
		this.getMap = function (mapId) {
			return maps[mapId];
		};
		
		this.switchMap = function(newMapId, selectedFeatureId) {
		  console.log("switch to " + newMapId);
			dataService.removeGeometries();
			
			dataService.fb.child('maps').child(newMapId).once('value', function(mapSnap) {
				var mapData = mapSnap.val();
				if (!mapData) {
				  alert("Cannot find map <" + newMapId + ">, chooose anothe one.");
				  return ;
				}
				var tileUrl = mapData.tiles;
				
				if (mainLayer) self.map.removeLayer(mainLayer);
				mainLayer = L.tileLayer(tileUrl+'/{z}/{x}/{y}.png', {
					minZoom: 2, 
					maxZoom: newMapId === 'debarbari' ? 8 : 7, //! HACK -- deBarbari has more zoom levels than the rest 
					tms: true, 
					bounds: mapData.bounds, 
					contonuousWorld: true
				}).addTo(self.map);
				
				if (miniMap) self.map.removeControl(miniMap);
				var tms2 = L.tileLayer(tileUrl+'/{z}/{x}/{y}.png', {
					minZoom: 1, 
					maxZoom: 1, 
					tms: true
				});
				miniMap = new L.Control.MiniMap(tms2, { toggleDisplay: true }).addTo(self.map);
				
				if (mapData.bounds) self.map.fitBounds(shiftBounds(mapData.bounds));
				
				dataService.setMap(newMapId);
				switchFunc(mapSnap.val(), selectedFeatureId);
				
				markActiveMap(newMapId);
			});
		};
		
		this.onSwitch = function (func) {
			switchFunc = func;
		};
		
		/* Create a menu item for each map
		 */
		this.initMenu = function() {
			dataService.fb.child('maps').orderByChild('year').on('child_added', function (snapshot) {
				var data = snapshot.val();
				maps[snapshot.key()] = data;
					
				$(document).ready(function() {
					var isActive = data.id === dataService.currentMap();
					var $item = $('<li>', {
						role: 'presentation',
						'class': 'map-menu-item',
						'data-map-year': data.year
					});
					var $link = $('<a>', {
						role: 'menuitem',
						id: data.id + '-map',
						href: '#',
						'class': 'map-menu-link map-inactive',
						html: self.mapLabel(data.id)
					});
					if (isActive) {
						$link.removeClass('map-inactive').addClass('map-active');
					}
					$link.on('click', self.switchMap.bind(this, data.id));
					$item.append($link);

					var $targetMenu;
					if (data.parent) {
						$targetMenu = ensureMapParentMenu(data.parent);
					} else {
						$targetMenu = $('.maps-menu');
					}
					insertMapMenuItem($targetMenu, $item, data.year);

					$('.maps-menu').removeClass('loading');
					$('.maps-select').append('<option value="'+data.id+'">'+data.name+'</option>');
				});
			});
		};
		
		this.initMap = function() {
			// Initialize leaflet map
			self.map = L.map('map', { center: [-73, 294], zoom: 3, attributionControl: false });
			window.lmap = self.map;
			
			self.switchMap( dataService.currentMap() );

			// Add zoom out button
			var ViewAllControl = L.Control.extend({
				options: {
					position: 'topleft'
				},

				onAdd: function (map) {
					// Create the control container with a particular class name
					var container = L.DomUtil.create('div', 'leaflet-bar');

					var link = L.DomUtil.create('a', '', container);
					link.href = "#";

					// Add a click handler
					$(link).click(function() {
						map.setZoom(1);
					});

					var img = L.DomUtil.create('img', 'fullscreen-link', link);
					img.src = "img/fullscreen.png";
					img.style.width = '14px';
					img.style.height = '14px';

					return container;
				}
			});

			this.map.addControl(new ViewAllControl());

		};
		
		/* Add a new layer to the map.
		 * Updates the database and the layer menu
		 */
		this.addNewMap = function () {
			// Read values from the form
			var name = $('#new-map-name').val();
			var id = $('#new-map-id').val();
			var year = $('#new-map-year').val();
			var tiles = $('#new-map-tiles').val();

			// Fail silently if fields empty for now
			if (!(name || id || year || tiles)) {
				return;
			} else if (maps[id]) {
				// Fail silently if duplicate
				return;
			}
			let username = "default"; // fallback default
			let usernameElement = document.getElementById("loggedin-username");

			if (usernameElement && usernameElement.textContent.trim() !== "") {
				username = usernameElement.textContent.trim();
			}
			dataService.fb.child('maps').child(id).set({
				name: name, 
				id: id, 
				year: year, 
				tiles: tiles, 
				createdBy: username
			});
			$('#new-map').modal('hide');
		};
	}
	
	return MapManager;
});
