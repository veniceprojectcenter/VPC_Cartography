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
                    
        /* Create a menu item for each layer
        */
        this.initMenu = function () {
  dataService.get('layers', function (snapshot) {
    var data = snapshot.val();
    $(document).ready(function() {
      // build one <li> containing BOTH the toggle-anchor and a tiny edit-button
      var loggedIn = document.getElementById('drawmode').style.display !== 'none';
      var newOption = ''
    + '<li role="presentation">'
    +   '<a role="menuitem" id="'+data.id+'-layer" href="#" class="layer-toggle">'
    +     data.name
    +   '</a>';
    if (loggedIn) {
        newOption += ' <a href="#" '
            + 'class="edit-layer-btn" '
            + 'data-layer-id="'+data.id+'" '
            + 'style="font-size:0.8em; margin-left:6px;"'
            + '>✎</a>';
    }
    newOption += '</li>';

      // insert into whichever menu
      if (data.parent) {
        var parentId = data.parent.replace(/\s/g,'');
        if (!$('#'+parentId+'-menu').length) {
          // … your submenu-creation code …
        }
        $('#'+parentId+'-menu').append(newOption);
      } else {
        $('.layers-menu').append(newOption);
      }

      // remove loading state
      $('.layers-menu').removeClass('loading');

      // wire up the toggle on the name
      $('#' + data.id + '-layer')
        .click(self.toggleLayer.bind(self, data.id, data.color));

      // wire up the tiny edit button
      $('.edit-layer-btn[data-layer-id="'+data.id+'"]')
        .on('click', function(e){
          e.preventDefault();
          self.showEditLayerModal(data.id);
        });

      // also keep your <select> in sync
      $('.layers-select').append(
        '<option value="'+data.id+'">'+data.name+'</option>'
      );

      // default-enabled color logic stays the same…
      if (defaultEnabledLayer && data.id == defaultEnabledLayer) {
        layerColors[data.id] = data.color;
        defaultEnabledLayer = undefined;
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
            dataService.fb.child('layers').push({
                name: name, 
                id: id, 
                color: color,
                parent: parent,
                createdBy: username
            });
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
            
            // dataService.fb.child('vpc/features').push(newData);
            var newRef = dataService.fb.child('features').push();
            console.log("Nuova Chiave", newRef.key(), newData);
            newRef.set(newData, function(error){
              console.log("Errore", error);
              alert("Aggiunto Elemento " + newRef.key());
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
          // console.log(
          //   "ID  ", selectedData.id,
          //   'name', $('#edit-feature-name').val(),
          //   'link', $('#edit-feature-type').val(),
          //   'type', $('#edit-feature-link').val()
          // );
          selectedData.properties.name = $('#edit-feature-name').val();
          selectedData.properties.type = $('#edit-feature-type').val();
          selectedData.properties.code = $('#edit-feature-code').val(); // ← new line
          selectedData.properties.link = $('#edit-feature-link').val();
          dataService.fb.child('features').child(selectedData.id).child('properties').update({
            name: $('#edit-feature-name').val(),
            type: $('#edit-feature-type').val(),
            code: $('#edit-feature-code').val(),
            link: $('#edit-feature-link').val()
          }, function(error){
            if (error) return alert("Error: " + error);
            $('#edit-layer').modal('hide');
            dataService.updateItem(selectedData);
            myDisableLayer($('#edit-feature-type').val());
            myEnableLayer($('#edit-feature-type').val());
            mapManager.map.closePopup();
          });
        };
        
        this.deletePoly = function(){
          if (!confirm("DELETE feature " + selectedData.id)) return;
          
          var cur_type = selectedData.properties.type;
          
          dataService.deleteItem(selectedData);
        
        console.log("dd", dataService.currentMap(), selectedData.id);
          dataService.fb.child('features').child(selectedData.id).remove();
          dataService.fb.child('geometries').child(dataService.currentMap()).child(selectedData.id).remove();
          
          myDisableLayer(cur_type);
        myEnableLayer(cur_type);
        }
        
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
                            content = '<a href="' + feature.properties.link + '" target="blank_">' + content + '</a>';
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

            $('#'+type+'-layer').css('font-weight', 600);
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
            
            $('#'+type+'-layer').css('font-weight', 400);

            delete polyState[type];
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
            // Update autocomplete based on selected layers
            var activeLandmarks; 
            if (Object.keys(polyState).length === 0) {
                activeLandmarks = dataService.all();
            } else {
                activeLandmarks = Object.keys(activeLandmarksObj).map(function(k){ return activeLandmarksObj[k]; });
            }
    
            $('.search').autocomplete({ 
                source: activeLandmarks.map(function(feature) {
                    return feature.properties.name;
                })
            });
        };

		// Show the modal and pre-fill it with the layer’s current name & color
		this.showEditLayerModal = function(layerId) {
		// Find the Firebase record whose .id === layerId
		dataService.fb.child('layers')
			.orderByChild('id')
			.equalTo(layerId)
			.limitToFirst(1)
			.once('value', function(snapshot) {
			const record = snapshot.val();
			if (!record) return alert("Layer not found!");
			// grab the push-key
			const pushKey = Object.keys(record)[0];
			const layerData = record[pushKey];

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
			});
		};

		// Pull values from modal, write back to Firebase, update UI + map
		this.saveEditedLayer = function() {
		const key     = $('#edit-layer-key').val();   // fb push-key
		const layerId = $('#edit-layer-id').val();    // your id property
		const newName = $('#edit-layer-name').val().trim();
		const newColor= $('#edit-layer-color').val();

		if (!key) return alert("Missing layer key!");

		dataService.fb.child('layers').child(key)
			.update({ name: newName, color: newColor }, function(err) {
			if (err) return alert("Update failed: " + err);

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

			$('#edit-layer-modal').modal('hide');
			});
		};

		this.deleteLayer = function() {
		const key     = $('#edit-layer-key').val();
		const layerId = $('#edit-layer-id').val();

		if (!key) return alert("Missing layer key!");
		if (!confirm("Really delete layer “" + $('#edit-layer-name').val() + "”? This will also remove its polygons from the map.")) {
			return;
		}

		// 1) remove the layer entry
		dataService.fb.child('layers').child(key).remove(function(err) {
			if (err) return alert("Delete failed: " + err);

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

