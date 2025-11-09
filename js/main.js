// From: https://github.com/litejs/natural-compare-lite
String.naturalCompare = function(a, b) {
	var i, codeA, codeB = 1, posA = 0, posB = 0, alphabet = String.alphabet;

	function getCode(str, pos, code) {
		if (code) {
			for (i = pos; code = getCode(str, i), code < 76 && code > 65;) ++i;
			return +str.slice(pos - 1, i);
		}
		code = alphabet && alphabet.indexOf(str.charAt(pos));
		return code > -1 ? code + 76 : ((code = str.charCodeAt(pos) || 0), code < 45 || code > 127) ? code
			: code < 46 ? 65               // -
			: code < 48 ? code - 1
			: code < 58 ? code + 18        // 0-9
			: code < 65 ? code - 11
			: code < 91 ? code + 11        // A-Z
			: code < 97 ? code - 37
			: code < 123 ? code + 5        // a-z
			: code - 63;
	}


	if ((a+="") != (b+="")) for (;codeB;) {
		codeA = getCode(a, posA++);
		codeB = getCode(b, posB++);

		if (codeA < 76 && codeB < 76 && codeA > 66 && codeB > 66) {
			codeA = getCode(a, posA, posA);
			codeB = getCode(b, posB, posA = i);
			posB = i;
		}

		if (codeA != codeB) return (codeA < codeB) ? -1 : 1;
	}
	return 0;
};

define(['jquery', 'UrlMap', 'Firebase', 'FirebaseAuth','FirebaseAuth-modern', 'RectDrawer', 'PolyDrawer', 'DataService', 'LayerManager', 'MapManager', 'Downloader', 'jquery-ui', 'bootstrap'], 
		function($, UrlMap, Firebase, FirebaseAuth, FirebaseAuthModern , RectDrawer, PolyDrawer, DataService, LayerManager, MapManager, Downloader) {
	"use strict";
	
	/// CONSTANTS
	var DEFAULT_MAP = 'debarbari';
	var FIREBASE_URL = 'https://vpc.firebaseio.com/cartography';
	var SHARE_BASE_URL = 'https://cartography.veniceprojectcenter.org/';
	
	/// EXTERNAL LIBRARIES
	var fb = new Firebase(FIREBASE_URL);
	var fbAuth = new FirebaseAuth(fb);

	var firebaseConfig = {
		apiKey: "AIzaSyCUh3jgJD4E_YZUaBvRAeSKwf5lvDv4sy4",
		authDomain: "vpc.firebaseapp.com",
		databaseURL: "https://vpc.firebaseio.com",
		projectId: "firebase-vpc",
		// (optional: storageBucket, messagingSenderId, etc.)
	  };

	var fbAuth2 = new FirebaseAuthModern(firebaseConfig);
	
	/// CORE FUNCTIONALITY
	var urlMap = new UrlMap();
	var dataService = new DataService(fb, fbAuth, urlMap.map, fbAuth2); //.DEFAULT_MAP);
	var mapManager = new MapManager(dataService);
	var defaultUrlLayers = (urlMap.layers && urlMap.layers.length) ? urlMap.layers.slice() : (urlMap.layer ? [urlMap.layer] : []);
	var layerManager = new LayerManager(dataService, mapManager, defaultUrlLayers);
	mapManager.onSwitch(function(mapData, selectedFeatureId){
	  layerManager.reload(mapData, selectedFeatureId);
	  if (defaultUrlLayers.length) {
		  var layersToEnable = defaultUrlLayers.slice();
		  defaultUrlLayers = [];
		  setTimeout(function(){
	  		  console.log("Enable layers from URL", layersToEnable);
	  		  enableLayersFromUrl(layersToEnable);
		}, 1250);
		}
	});

	function enableLayersFromUrl(layers) {
		if (!layers || !layers.length) return;
		var uniqueLayers = [];
		layers.forEach(function(layerId) {
			if (layerId && uniqueLayers.indexOf(layerId) === -1) {
				uniqueLayers.push(layerId);
			}
		});
		if (!uniqueLayers.length) return;
		var primaryLayer = uniqueLayers[0];
		var additionalLayers = uniqueLayers.slice(1);
		if (urlMap.feature) {
			fb.child('features').once('value', function (snapshot) {
				var featureFound = false;
				snapshot.forEach(function(childSnapshot) {
					if (childSnapshot.child('properties').child('name').val() == urlMap.feature) {
						featureFound = true;
						layerManager.enableLayer(primaryLayer, undefined, childSnapshot.key());
						return true;
					}
				});
				if (!featureFound) {
					layerManager.enableLayer(primaryLayer);
				}
				additionalLayers.forEach(function(layerId) {
					layerManager.enableLayer(layerId);
				});
			});
		} else {
			uniqueLayers.forEach(function(layerId) {
				layerManager.enableLayer(layerId);
			});
		}
	}

	/// EXTRA FUNCTIONALITY
	var downloader = new Downloader();
	var rectDrawer = new RectDrawer();
	var polyDrawer = new PolyDrawer(mapManager, layerManager, dataService);
	var SEARCH_MATCH_THRESHOLD = 0.8;
	var SEARCH_RESULTS_LIMIT = 12;
	

	/* 
	 * Load up the autocomplete bar with all the names
	 */
	function levenshteinDistance(a, b) {
		a = a || '';
		b = b || '';
		var matrix = [];
		var i;
		for (i = 0; i <= b.length; i++) {
			matrix[i] = [i];
		}
		for (var j = 0; j <= a.length; j++) {
			matrix[0][j] = j;
		}
		for (i = 1; i <= b.length; i++) {
			for (var k = 1; k <= a.length; k++) {
				if (b.charAt(i - 1) === a.charAt(k - 1)) {
					matrix[i][k] = matrix[i - 1][k - 1];
				} else {
					matrix[i][k] = Math.min(
						matrix[i - 1][k] + 1,
						matrix[i][k - 1] + 1,
						matrix[i - 1][k - 1] + 1
					);
				}
			}
		}
		return matrix[b.length][a.length];
	}

	function similarityScore(a, b) {
		if (!a && !b) return 1;
		var maxLen = Math.max(a.length, b.length);
		if (!maxLen) return 0;
		return 1 - (levenshteinDistance(a, b) / maxLen);
	}

	function matchScore(term, target) {
		if (!term || !target) return 0;
		if (target.indexOf(term) !== -1) {
			return 1;
		}
		return similarityScore(term, target);
	}

	function resolveMapInfo(mapId) {
		if (!mapId) {
			return null;
		}
		var mapData = mapManager.getMap(mapId);
		var yearNum = mapData && parseInt(mapData.year, 10);
		var hasYear = !!mapData && !!mapData.year;
		var displayName;
		if (mapData) {
			displayName = (hasYear ? mapData.year + ' – ' : '') + (mapData.name || mapId);
		} else {
			displayName = mapId;
		}
		return {
			id: mapId,
			display: displayName,
			sortYear: isNaN(yearNum) ? Number.MAX_SAFE_INTEGER : yearNum,
			sortName: (mapData && mapData.name) || mapId
		};
	}

	function buildSearchMatches(term) {
		if (!term) return [];
		var matches = [];
		var normalizedTerm = term.toLowerCase();
		var allFeatures = dataService.all();
		for (var i = 0; i < allFeatures.length; i++) {
			var feature = allFeatures[i];
			if (!feature || !feature.properties) continue;
			var props = feature.properties;
			var name = (props.name || '').trim();
			var code = (props.code || '').trim();
			var lowerName = name.toLowerCase();
			var lowerCode = code.toLowerCase();
			var mapIds = Array.isArray(props.maps) ? props.maps.slice() : [];
			var nameScore = matchScore(normalizedTerm, lowerName);
			var codeScore = matchScore(normalizedTerm, lowerCode);
			var bestScore = Math.max(nameScore, codeScore);
			if (bestScore >= SEARCH_MATCH_THRESHOLD) {
				var mapInfoList = mapIds.map(function(mapId) {
					return resolveMapInfo(mapId) || {
						id: mapId,
						display: mapId,
						sortYear: Number.MAX_SAFE_INTEGER,
						sortName: mapId
					};
				}).sort(function(a, b) {
					if (a.sortYear !== b.sortYear) return a.sortYear - b.sortYear;
					return a.sortName.localeCompare(b.sortName);
				});
				var mapDisplayNames = mapInfoList.map(function(info) { return info.display; });
				var availableOnCurrentMap = mapIds.indexOf(dataService.currentMap()) !== -1;
				matches.push({
					id: feature.id,
					name: name || '(Untitled Feature)',
					code: code,
					layer: props.type,
					score: bestScore,
					maps: mapDisplayNames,
					availableOnCurrent: availableOnCurrentMap
				});
			}
		}
		matches.sort(function(a, b) {
			if (b.score !== a.score) return b.score - a.score;
			return a.name.localeCompare(b.name);
		});
		return matches.slice(0, SEARCH_RESULTS_LIMIT);
	}

	function setupSearchUi() {
		$(document).ready(function() {
			var $searchInput = $('#mini-search');
			var $resultsList = $('#search-results');
			if (!$searchInput.length || !$resultsList.length) return;

			function hideResults() {
				$resultsList.empty().removeClass('visible');
			}

			function renderResults(results) {
				$resultsList.empty();
				if (!results.length) {
					hideResults();
					return;
				}
				results.forEach(function(result) {
					var $item = $('<li>', {
						'class': 'search-result-item',
						role: 'option'
					});
					$item.data('featureId', result.id);
					$item.data('layerId', result.layer);
					if (!result.availableOnCurrent) {
						$item.addClass('result-unavailable');
					}
					$('<span>', { 'class': 'result-title', text: result.name }).appendTo($item);
					if (result.code) {
						$('<span>', { 'class': 'result-code', text: 'Code: ' + result.code }).appendTo($item);
					}
					var mapsSubtitle = result.maps && result.maps.length ? 'Maps: ' + result.maps.join(', ') : 'Maps: Not linked yet';
					$('<span>', { 'class': 'result-maps', text: mapsSubtitle }).appendTo($item);
					$resultsList.append($item);
				});
				$resultsList.addClass('visible');
			}

			$searchInput.on('input', function() {
				var term = $(this).val().trim().toLowerCase();
				if (!term) {
					hideResults();
					return;
				}
				renderResults(buildSearchMatches(term));
			});

			$searchInput.on('keydown', function(event) {
				if (event.key === 'Escape') {
					hideResults();
					$(this).val('');
				} else if (event.key === 'Enter') {
					var $first = $resultsList.children('.search-result-item').first();
					if ($first.length) {
						event.preventDefault();
						$first.trigger('click');
					}
				}
			});

			$resultsList.on('mousedown', function(e) {
				e.preventDefault();
			});

			$resultsList.on('click', '.search-result-item', function() {
				var featureId = $(this).data('featureId');
				var featureName = $(this).find('.result-title').text();
				hideResults();
				if (featureName) {
					$searchInput.val(featureName);
				}
				layerManager.focusFeature(featureId);
			});

			$(document).on('click', function(e) {
				if (!$(e.target).closest('.search-wrapper').length) {
					hideResults();
				}
			});
		});
	}

	function initializeSearch() {
		fb.child('features').on('child_added', function (snapshot) {
			var feature = snapshot.val();
			feature.id = snapshot.key();
			dataService.push(feature);
		});
		setupSearchUi();
	}

	function buildShareUrl() {
		var params = [];
		var currentMapId = dataService.currentMap();
		if (currentMapId) {
			params.push('map=' + encodeURIComponent(currentMapId));
		}
		var enabledLayers = layerManager.getEnabledLayers();
		if (enabledLayers.length) {
			params.push('layer=' + encodeURIComponent(enabledLayers.join('|')));
		}
		var query = params.length ? ('?' + params.join('&')) : '';
		return SHARE_BASE_URL + query;
	}

	function shareCurrentView() {
		var shareUrl = buildShareUrl();
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(shareUrl)
				.then(function() {
					alert('Shareable link copied to clipboard!');
				})
				.catch(function() {
					window.prompt('Copy this shareable URL', shareUrl);
				});
		} else {
			window.prompt('Copy this shareable URL', shareUrl);
		}
	}
	
	/* 
	 * Show the login form
	 */
	function showLoginForm(type) {
		var callback;
		if (type === "login") {
			callback = fbAuth2.login;
		}
		else {
			alert("Not working yet. Check back soon!");
			return;
	
			//Uncomment this when it's needed:
			//callback = fbAuth.signup;
		}
	  
	  function doLogin(){
	    console.log("Login attempt started");
			callback($('#email').val(), $('#password').val());
	  }
		$('#password').on('keyup', function(e) {
			if (e.keyCode === 13) doLogin();
		});
		$('#login-submit').on('click', doLogin);
		$('#login-cancel').on('click', function(e){
		  $('#login-form').css('display', 'none');
  		$('#login-text').show();
		});
	
		$('#login-form').css('display', 'block');
		$('#login-text').hide();
	}
		
	// Kick off the loading
	mapManager.initMenu();
	layerManager.initMenu();
	initializeSearch();

	// jQuery init
	$(document).ready(function() {
		
		mapManager.initMap();
		
		// Register handlers
		$("#dlbutton").click(function () {
			var link = document.createElement("a");
			link.href = downloader.getData();
			link.download = "explorer.png";
			var theEvent = document.createEvent("MouseEvent");

			// Here we create and dispatch a "realistic" event
			// to fool browsers' built-in popup blockers
			theEvent.initMouseEvent("click", true, true, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null);
			link.dispatchEvent(theEvent);
		});

		$("#select").click(rectDrawer.initialize.bind(rectDrawer, downloader.downloadSection));

		$('#drawmode').click(polyDrawer.startPolyMode);
		$('#share').click(shareCurrentView);

		$('#login-link').click(function () {
			showLoginForm('login');
		});
		$('#signup-link').click(function () {
			showLoginForm('signup');
		});
		$('#logout-link').click(fbAuth.logout);

		$('#new-layer-button').click(layerManager.addNewLayer);
		$('#new-map-button').click(mapManager.addNewMap);
		$('#new-feature-submit').click(polyDrawer.submitFeature);
		$('#new-feature-discard').click(polyDrawer.discardFeature);
		
		$('#feature-filter').on('change', function() {
			var features = dataService.findDataByType($(this).val()).sort(String.naturalCompare);
			
			var options = features.map(function(feature) {
				return '<option value="'+feature.id+'">'+feature.properties.name+'</option>';
			});
			
			$('.features-select').html(options.join(''));
		});

		$('#clone-button').click(layerManager.clonePoly);
		$('#update-button').click(layerManager.editFeature);
		
		$('#map').on('click', '.clone', function() {
			layerManager.cloneModal();
		}).on('click', '.delete', function() {
			layerManager.deletePoly();
		}).on('click', '.show_other_map', function() {
			var selectedData = layerManager.selectedData();
			mapManager.map.closePopup();
			mapManager.switchMap($(this).attr('data-map-id'), selectedData.id);
		}).on('click', '.edit', function() {
  		layerManager.editModal();
  	});

		$('#plus-sign').click(function () {
			$('#info-modal').modal('show');
		});

		// Tooltips
		$('#dlbutton').tooltip({ placement: 'bottom' });
		$('#select').tooltip({ placement: 'bottom' });
		$('#drawmode').tooltip({ placement: 'bottom' });
		$('#share').tooltip({ placement: 'bottom' });
		$('#plus-sign').tooltip({ placement: 'bottom' });
		$('#layers').tooltip({ placement: 'bottom' });
		$('#maps').tooltip({ placement: 'bottom' });
		$('#layer-dropdown').on('show.bs.dropdown', function () {
			try {
				$('#layers').tooltip("hide");
			} catch (e) {
				$('#layers').tooltip("option", "disabled", true);
			}
		});
		$('#map-dropdown').on('show.bs.dropdown', function () {
			try {
				$('#maps').tooltip("hide");
			} catch (e) {
				$('#maps').tooltip("option", "disabled", true);
			}
		});
	});
	
	return true;
});
