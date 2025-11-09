define([], function() {
  function UrlMap(){
    /// CONSTANTS
  	var DEFAULT_MAP = 'debarbari';
  	
    var urlMapEl = {}
    function parseLayerParam(layerValue) {
      if (!layerValue) return [];
      return layerValue.split('|').map(function(value) {
        return (value || '').trim();
      }).filter(function(value) {
        return value.length > 0;
      });
    }

    urlMapEl.getUrlParameter = function getUrlParameter(sParam) {
        var sPageURL = decodeURIComponent(window.location.search.substring(1)),
            sURLVariables = sPageURL.split('&'),
            sParameterName,
            i;

        for (i = 0; i < sURLVariables.length; i++) {
            sParameterName = sURLVariables[i].split('=');

            if (sParameterName[0] === sParam) {
                return sParameterName[1] === undefined ? true : sParameterName[1];
            }
        }
    };
  
    urlMapEl.map     = urlMapEl.getUrlParameter('map');
    var rawLayerParam = urlMapEl.getUrlParameter('layer');
    urlMapEl.layers  = parseLayerParam(rawLayerParam);
    urlMapEl.layer   = urlMapEl.layers.length ? urlMapEl.layers[0] : rawLayerParam;
    urlMapEl.feature = urlMapEl.getUrlParameter('feature');

    urlMapEl.setPrimaryLayer = function(layerId) {
      if (!layerId) return;
      urlMapEl.layers = urlMapEl.layers || [];
      var idx = urlMapEl.layers.indexOf(layerId);
      if (idx > 0) {
        urlMapEl.layers.splice(idx, 1);
      }
      if (idx !== 0) {
        urlMapEl.layers.unshift(layerId);
      } else if (idx === -1) {
        urlMapEl.layers.unshift(layerId);
      }
      urlMapEl.layer = layerId;
    };

    urlMapEl.parseParameters = function(){
      if (urlMapEl.feature) {
        console.log("Switch to feature " + urlMapEl.feature);
        if (!urlMapEl.layer) urlMapEl.setPrimaryLayer('island');
        if (!urlMapEl.map  ) urlMapEl.map   = DEFAULT_MAP; //'debarbari-map';
    
      } else if (urlMapEl.layer) {
        console.log("Switch to layer " + urlMapEl.layer);
        if (!urlMapEl.map  ) urlMapEl.map   = DEFAULT_MAP; //'debarbari-map';
    
      } else if (urlMapEl.map) {
        console.log("Switch to map " + urlMapEl.map);
        // var selectedData = layerManager.selectedData();
    		// mapManager.map.closePopup();
    		// mapManager.switchMap(map, selectedData.id);
    		// mapManager.switchMap( map );
      } else {
        console.log("NO API CALLED");
        urlMapEl.map   = DEFAULT_MAP;
      }

      if (urlMapEl.layer && (!urlMapEl.layers || urlMapEl.layers.length === 0)) {
        urlMapEl.setPrimaryLayer(urlMapEl.layer);
      }
    };
  
    urlMapEl.parseParameters();
    
    return urlMapEl;
  }
  
  return UrlMap;
});
