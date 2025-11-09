define(['lodash'], function(_) {
    "use strict";
    
    // Handle things related to the overlays
    function LayerManager(dataService, mapManager, defaultEnabledLayer) {
        var self = this;
        var polyState = {},
            enabledLayers = [],
            layerColors = {},
            selectedPoly = null,
            selectedData = null,
            activeLandmarksObj = {}; // keyed by feature id

        var defaultEnabledLayers = [];
        if (Array.isArray(defaultEnabledLayer)) {
            defaultEnabledLayers = defaultEnabledLayer.slice();
        } else if (defaultEnabledLayer) {
            defaultEnabledLayers = [defaultEnabledLayer];
        }
        var defaultLayerLookup = defaultEnabledLayers.reduce(function(acc, layerId) {
            acc[layerId] = true;
            return acc;
        }, {});

        function setLayerButtonState(layerId, isActive) {
            var $button = $('#' + layerId + '-layer');
            if (!$button.length) return;
            $button.toggleClass('layer-active', !!isActive);
            $button.toggleClass('layer-inactive', !isActive);
        }
                    
        function ensureLayerParentMenu(parentName) {
            var parentId = parentName.replace(/\s/g,'');
            var $existing = $('#' + parentId + '-menu');
            if ($existing.length) {
                return $existing;
            }
            var $group = $('<li>', { 'class': 'dropdown-submenu layer-group' });
            var $label = $('<a>', { href: '#', text: parentName });
            var $menu = $('<ul>', {
                id: parentId + '-menu',
                'class': 'dropdown-menu'
            });
            $group.append($label).append($menu);

            var $newLayerTrigger = $('#new-layer-menu');
            if ($newLayerTrigger.length) {
                $newLayerTrigger.before($group);
            } else {
                $('.layers-menu').append($group);
            }
            return $menu;
        }

        function insertLayerMenuItem($menu, $item) {
            var inserted = false;
            var newName = ($item.data('layerName') || '').toString();
            $menu.children('li.layer-menu-item').each(function() {
                var $existing = $(this);
                var existingName = ($existing.data('layerName') || '').toString();
                if (newName.localeCompare(existingName) < 0) {
                    $existing.before($item);
                    inserted = true;
                    return false;
                }
            });

            if (!inserted) {
                var $newLayerLink = $menu.children('#new-layer-menu');
                if ($newLayerLink.length) {
                    $newLayerLink.before($item);
                } else {
                    $menu.append($item);
                }
            }
        }

        /* Create a menu item for each layer
        */
        this.initMenu = function () {
            dataService.get('layers', function (snapshot) {
                var data = snapshot.val();
                $(document).ready(function() {
                    var loggedIn = document.getElementById('drawmode').style.display !== 'none';
                    var $item = $('<li>', {
                        role: 'presentation',
                        'class': 'layer-menu-item',
                        'data-layer-name': (data.name || '').toLowerCase()
                    });

                    var $toggle = $('<a>', {
                        role: 'menuitem',
                        id: data.id + '-layer',
                        href: '#',
                        'class': 'layer-toggle layer-inactive',
                        text: data.name
                    });
                    $toggle.on('click', self.toggleLayer.bind(self, data.id, data.color));
                    $item.append($toggle);

                    if (loggedIn) {
                        var $editButton = $('<a>', {
                            href: '#',
                            'class': 'edit-layer-btn',
                            'data-layer-id': data.id,
                            text: '✎'
                        }).css({ fontSize: '0.8em', marginLeft: '6px' });
                        $editButton.on('click', function(e) {
                            e.preventDefault();
                            self.showEditLayerModal(data.id);
                        });
                        $item.append($editButton);
                    }

                    var $targetMenu;
                    if (data.parent) {
                        $targetMenu = ensureLayerParentMenu(data.parent);
                    } else {
                        $targetMenu = $('.layers-menu');
                    }

                    insertLayerMenuItem($targetMenu, $item);
                    $('.layers-menu').removeClass('loading');

                    $('.layers-select').append('<option value="'+data.id+'">'+data.name+'</option>');

                    if (defaultLayerLookup[data.id]) {
                        layerColors[data.id] = data.color;
                        delete defaultLayerLookup[data.id];
                    }
                });
            });
        };
        
        this.mostRecentlyEnabled = function() {
            return enabledLayers.length ? enabledLayers[enabledLayers.length-1] : null;
        };
        
        this.selectedData = function() {
            return selectedData;
        };
        
        this.selectedPoly = function() {
            return selectedPoly;
        };

        this.getEnabledLayers = function() {
            return enabledLayers.slice();
        };
        
        /* Add a new layer to the map.
         * Updates the database and the layer menu
         */
        this.addNewLayer = function () {
            // Read values from the form
            var name = $('#new-layer-name').val();
            var id = $('#new-layer-id').val();
            var color = $('#new-layer-color').val();
            var parent = $('#new-layer-parent').val();

            if (parent === "Other") {
                parent = $('#new-layer-new-parent').val();
            }

            // Fail silently if fields empty for now
            if (!(name || id || color)) {
                return;
            }
            let username = "default"; // fallback default
            let usernameElement = document.getElementById("loggedin-username");

            if (usernameElement && usernameElement.textContent.trim() !== "") {
                username = usernameElement.textContent.trim();
            }
            // TODO generalize for any account
            const layerRef = dataService.fbAuth2.ref('cartography/layers/');
            const newLayerRef = dataService.fbAuth2.push(layerRef);
            dataService.fbAuth2.set(newLayerRef,
                {
                name: name,
                id: id,
                color: color,
                parent: parent,
                createdBy: username
            }
            ).then(() => {
                // Optional: Get the key if needed
                const newKey = newLayerRef.key; 
                console.log("New layer successfully pushed with key:", newKey);
            })
            .catch((error) => {
                console.error("Error pushing new layer:", error);
            });;
            $('#new-layer').modal('hide');
        };

        /* Shows the polygon cloning modal
         */
        this.cloneModal = function () {
            $('#clone-layer').modal('show');
        };

        /* Clones the feature to a new layer
         */
        this.clonePoly = function () {
        var newData = $.extend(true, {}, selectedData); // clone the data
        newData.properties.type = $('#clone-layer-type').val();
        
        const featuresRef = dataService.fbAuth2.ref('cartography/features');
        const newRef = dataService.fbAuth2.push(featuresRef);

        console.log("Nuova Chiave", newRef.key, newData);
        
        dataService.fbAuth2.set(newRef, newData)
            .then(() => {
                console.log("Success");
                alert("Aggiunto Elemento " + newRef.key);
            })
            .catch((error) => {
                console.log("Errore", error);
            });

        $('#clone-layer').modal('hide');
        mapManager.map.closePopup();
        };
        
        /* Shows the edit modal
         */
        this.editModal = function () {
          console.log("selectedData", selectedData);
          
          $('#edit-feature-id'  ).html(selectedData.id            );
          $('#edit-feature-name').val(selectedData.properties.name);
          $('#edit-feature-type').val(selectedData.properties.type);
          $('#edit-feature-code').val(selectedData.properties.code || '');
          $('#edit-feature-link').val(selectedData.properties.link);
          
            $('#edit-layer').modal('show');
            
            // var name = $('#new-layer-name').val();
            // var id = $('#new-layer-id').val();
            // var color = $('#new-layer-color').val();
            // var parent = $('#new-layer-parent').val();
      // 
            // if (parent === "Other") {
            //  parent = $('#new-layer-new-parent').val();
            // }
        };

        /* Clones the feature to a new layer
         */
        this.editFeature = function () {
        selectedData.properties.name = $('#edit-feature-name').val();
        selectedData.properties.type = $('#edit-feature-type').val();
        selectedData.properties.code = $('#edit-feature-code').val();
        selectedData.properties.link = $('#edit-feature-link').val();

        // UPDATED: Added 'cartography/'
        const propertiesRef = dataService.fbAuth2.ref('cartography/features/' + selectedData.id + '/properties');
        
        dataService.fbAuth2.update(propertiesRef, {
            name: $('#edit-feature-name').val(),
            type: $('#edit-feature-type').val(),
            code: $('#edit-feature-code').val(),
            link: $('#edit-feature-link').val()
        })
        .then(() => {
            $('#edit-layer').modal('hide');
            dataService.updateItem(selectedData);
            myDisableLayer($('#edit-feature-type').val());
            myEnableLayer($('#edit-feature-type').val());
            mapManager.map.closePopup();
        })
        .catch((error) => {
            return alert("Error: " + error);
        });
    };
        
        this.deletePoly = function(){
            if (!confirm("DELETE feature " + selectedData.id)) return;
            
            var cur_type = selectedData.properties.type;
            
            dataService.deleteItem(selectedData);

            console.log("dd", dataService.currentMap(), selectedData.id);
            
            // UPDATED: Added 'cartography/' to both references
            const featureRef = dataService.fbAuth2.ref('cartography/features/' + selectedData.id);
            const geometryRef = dataService.fbAuth2.ref('cartography/geometries/' + dataService.currentMap() + '/' + selectedData.id);

            Promise.all([
                dataService.fbAuth2.remove(featureRef),
                dataService.fbAuth2.remove(geometryRef)
            ])
            .then(() => {
                mapManager.map.closePopup();
                myDisableLayer(cur_type);
                myEnableLayer(cur_type);
            })
            .catch(err => {
                alert("Delete failed: " + err.message);
            });
        };
        
        /* Turns a overlay layer on or off.
         * When layers are enabled, only the enalbed layers' features
         * appear in the search.
         */
        this.toggleLayer = function (type, color) {
          console.log("Abilito", type);
            if (!polyState[type]) {
                self.enableLayer(type, color);
            } else {
                self.disableLayer(type);
            }

            self.updateAutocomplete();
        };
        
        this.enableLayer = function(type, color, selectedFeatureId) {
            if (color) {
                layerColors[type] = color;
            } else {
                color = layerColors[type];
            }
            
            // This is used way down in the "visible on x other maps" loop
            var currentMap = dataService.currentMap();
            
            // If the layer is not visible, create it
            polyState[type] = [];
            enabledLayers.push(type);
            dataService.getFeaturesForLayer(type, function(feature) {
                // Detect whether this layer was disabled since this function
                // was called. This should rarely happen because callbacks are canceled.
                if (!polyState[type]) return;
                
                if (feature.properties.type == type && feature.geometry) {
                    var points = dataService.geoJSONToLeaflet(feature.geometry.coordinates[0]);
                    var newPoly = L.polygon(points, {color: color, weight: 2});

                    // Clicking on a polygon will bring up a pop up
                    newPoly.on('click', function() {
                        var content = '<b class="popup">'+feature.properties.name+'</b>';

					

                         if (feature.properties.link) {
                            // --- FIX FOR VENIPEDIA LINKS! ---
                            let correctedLink = feature.properties.link.replace('venipedia.org', 'wiki.cityknowledge.org');
                            correctedLink = correctedLink.replace('www.', '');
                            correctedLink = correctedLink.replace('http://', 'https://');
                            content = '<a href="' + correctedLink + '" target="blank_">' + content + '</a>';
                            // -------------------
                        }
						if (feature.properties.code) {
							content += '<br/><strong>Code:</strong> ' 
									+ feature.properties.code 
									+ '<br/>';
						}
                        var numMaps = feature.properties.maps.length - 1; // Subtract one for the current map
                        if (numMaps > 0) {
                            content += '<details><summary>This feature appears on '+numMaps+' other '+(numMaps === 1 ? 'map' : 'maps')+'</summary>';
                            Object.keys(feature.properties.maps).map(function(k) {
                                return feature.properties.maps[k];
                            }).sort(function(a, b) {
                                // Sort by year
                                return mapManager.getMap(a).year - mapManager.getMap(b).year;
                            }).forEach(function(mapId) {
                                if (mapId === currentMap) return;
                                content += '<a class="show_other_map" data-map-id="'+mapId+'">'+mapManager.mapLabel(mapId)+'</a>';
                            });
                            content += '</details>';
                        } else {
                            content += '<br />';
                        }
                        var loggedIn = document.getElementById('drawmode').style.display !== 'none';

						

                        if (loggedIn) {
                            //content += '<a class="edit" href="#">Edit</a> <a class="clone" href="#">Clone</a> <a class="delete" href="#">Delete</a>';
                            content += '<a class="edit" href="#">Edit Data</a> <a class="delete" href="#">Delete</a>';
                            content += '<a href="#" style="font-size:x-small; margin-left: 2px;" id="editfeature">Edit Polygon</a>';
                        }
                        L.popup({}, newPoly).setLatLng(newPoly.getBounds().getCenter()).setContent(content).openOn(mapManager.map);
                        const Editbutton = document.getElementById('editfeature');
                        const writeButton = document.getElementById('drawmode');
                        const btnGroup = document.querySelector('.btn-group');
						if(loggedIn){
                        Editbutton.addEventListener('click', function (){
                             writeButton.click();
                             const finishButton = document.createElement('button');
                                finishButton.id = 'finish';
                                finishButton.textContent = 'Finish Editing';
                                btnGroup.appendChild(finishButton);
                                finishButton.addEventListener('click', function (){
                                     writeButton.click();
                                     btnGroup.removeChild(finishButton);})
                    });
						}
                        selectedPoly = newPoly;
                        selectedData = feature;
                    });

                    if (selectedFeatureId === feature.id) {
                        newPoly.fire('click');
                        mapManager.map.setView(feature.properties.center).setZoom(5);
                    }

                    // Double clicking a polygon will center the landmark
                    // XXX Doesn't work?
                    newPoly.on('dblclick', function() {
                        mapManager.map.setView(feature.properties.center).setZoom(8);
                    });
                
                    newPoly.featureId = feature.id;
                    newPoly.addTo(mapManager.map);
                    polyState[type].push(newPoly);
                
                    activeLandmarksObj[feature.id] = feature;
                }
            });

            setLayerButtonState(type, true);
        };
        
        this.disableLayer = function(type) {
            // Cancel pending requests for this layer's geometry
            dataService.cancelGeometryRequests(type);
            
            // If the layer is visible, remove it
            for (var i = 0; i < polyState[type].length; ++i) {
                mapManager.map.removeLayer(polyState[type][i]);
                delete activeLandmarksObj[ polyState[type][i].featureId ];
            }
            
            enabledLayers.splice(enabledLayers.indexOf(type), 1);
            
            setLayerButtonState(type, false);

            delete polyState[type];
        };

        this.focusFeature = function(featureId) {
            if (!featureId) return;
            var feature = dataService.featureById(featureId);
            if (!feature || !feature.properties) return;
            var layerId = feature.properties.type;
            if (!layerId) return;

            if (!polyState[layerId]) {
                self.enableLayer(layerId, undefined, featureId);
                return;
            }

            var targetPoly;
            for (var i = 0; i < polyState[layerId].length; i++) {
                if (polyState[layerId][i].featureId === featureId) {
                    targetPoly = polyState[layerId][i];
                    break;
                }
            }

            if (targetPoly) {
                targetPoly.fire('click');
                if (feature.properties.center && mapManager.map) {
                    mapManager.map.setView(feature.properties.center).setZoom(5);
                }
            } else {
                self.enableLayer(layerId, undefined, featureId);
            }
        };

        var myEnableLayer  = self.enableLayer;
        var myDisableLayer = self.disableLayer;
        
        this.reload = function(map, selectedFeatureId) {
            dataService.cancelGeometryRequests();
            Object.keys(polyState).forEach(function(layerName) {
              
                self.disableLayer(layerName);
                self.enableLayer(layerName, undefined, selectedFeatureId);
            });
        };
        
        this.updateAutocomplete = function() {
            // Legacy no-op: search results managed via custom fuzzy search UI.
        };

 
        // Show the modal and pre-fill it with the layer’s current name & color
        this.showEditLayerModal = function(layerId) {
            // 1. Get the base reference to ALL layers
            const baseRef = dataService.fbAuth2.ref('cartography/layers');
            
            // 2. Execute a simple GET on the path to retrieve all data
            //    (This avoids the index-requiring orderByChild/equalTo query)
            dataService.fbAuth2.get(baseRef) // Assumes fbAuth2.get() is the promise-based fetch
                .then(function(snapshot) {
                    const allLayers = snapshot.val();
                    
                    if (!allLayers) {
                        return alert("Layer not found (Layer list empty)!");
                    }
                    
                    // 3. Find the correct Firebase push key by filtering client-side
                    const pushKey = Object.keys(allLayers).find(key => allLayers[key].id === layerId);
                    
                    if (!pushKey) {
                        return alert("Layer not found!");
                    }
                    
                    const layerData = allLayers[pushKey];

                    // stash into our hidden inputs
                    $('#edit-layer-key').val(pushKey);
                    $('#edit-layer-id').val(layerId);
                    $('#edit-layer-name').val(layerData.name);
                    $('#edit-layer-color').val(layerData.color);

                    // wire up the save button (clear any old handlers first)
                    $('#save-edit-layer')
                        .off('click')
                        .on('click', self.saveEditedLayer.bind(self));
                    $('#delete-layer')
                    .off('click')
                    .on('click', self.deleteLayer.bind(self));

                    $('#edit-layer-modal').modal('show');
                })
                .catch(function(error) {
                    console.error("Layer fetch failed:", error);
                    alert("An error occurred while fetching layer data. Check console.");
                });
        };

		// Pull values from modal, write back to Firebase, update UI + map
		this.saveEditedLayer = function() {
		const key     = $('#edit-layer-key').val();   // fb push-key
		const layerId = $('#edit-layer-id').val();    // your id property
		const newName = $('#edit-layer-name').val().trim();
		const newColor= $('#edit-layer-color').val();
		if (!key) return alert("Missing layer key!");
        const layerRef = dataService.fbAuth2.ref('cartography/layers/' + key);
        dataService.fbAuth2.update(layerRef, {
        name: newName,
        color: newColor
        }).then(() => {
        // 1) update the menu label
        $('#' + layerId + '-layer').text(newName);

        // 2) update the <select> option
        $('.layers-select option[value="'+layerId+'"]').text(newName);

        // 3) update our local color store
        layerColors[layerId] = newColor;

        // 4) if this layer is currently on the map, recolor its polygons
        if (polyState[layerId]) {
            polyState[layerId].forEach(function(poly) {
            poly.setStyle({ color: newColor });
            });
        }

        // 5) Close modal
        $('#edit-layer-modal').modal('hide');

        }).catch((err) => {
        alert("Update failed: " + err.message);
        });

		};

		this.deleteLayer = function() {
		const key     = $('#edit-layer-key').val();
		const layerId = $('#edit-layer-id').val();

		if (!key) return alert("Missing layer key!");
		if (!confirm("Really delete layer “" + $('#edit-layer-name').val() + "”? This will also remove its polygons from the map.")) {
			return;
		}
        const layerRef = dataService.fbAuth2.ref('cartography/layers/' + key);
		// 1) remove the layer entry
		dataService.fbAuth2.remove(layerRef).then(() => {

			// 2) if the layer is active, disable it (removes polygons)
			if (polyState[layerId]) {
			self.disableLayer(layerId);
			}

			// 3) remove from menus
			$('#' + layerId + '-layer').closest('li').remove();
			$('.layers-select option[value="'+layerId+'"]').remove();

			// 4) clean up local data
			delete layerColors[layerId];

			$('#edit-layer-modal').modal('hide');
		});

		// Optionally: also remove all features of that type:
		// dataService.fb.child('features')
		//   .orderByChild('properties/type')
		//   .equalTo(layerId)
		//   .once('value', snap => {
		//     snap.forEach(ch => ch.ref.remove());
		//   });
		};
    }
    
    return LayerManager;
});
