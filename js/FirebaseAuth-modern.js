define(['jquery'], function($) {
    function FirebaseAuthModern(config) {
      let auth;
      let db;
      let fbUser = null;
      let loggedIn = false;
  
      // Firebase method placeholders
      let signInWithEmailAndPasswordFn;
      let signOutFn;
      let refFn, childFn, updateFn;
  
      async function initFirebase() {
        const [
    { initializeApp },
    { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged },
    { getDatabase, ref, child, update }
  ] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js')  // ✅ NEW
  ]);
  
        const app = initializeApp(config);
        auth = getAuth(app);
        db = getDatabase(app);
  
        // Save references for later use
        signInWithEmailAndPasswordFn = signInWithEmailAndPassword;
        signOutFn = signOut;
        refFn = ref;
        childFn = child;
        updateFn = update;
  
        onAuthStateChanged(auth, (user) => {
          fbUser = user;
          loggedIn = !!user;
          updateUI(user);
        });
      }
  
      function updateUI(user) {
        if (user) {
          console.log("User logged in:", user);
          $('#login-form').hide();
          $('#login-text').hide();
          $('#loggedin-username').text(user.email);
          $('#loggedin-text').show();
          $('#drawmode').css('display', 'inline');
          $('.layers-menu').append('<li id="new-layer-menu"><a href="#" data-toggle="modal" data-target="#new-layer"><em>New Layer</em></a></li>');
          $('.maps-menu').append('<li id="new-map-menu"><a href="#" data-toggle="modal" data-target="#new-map"><em>New Map</em></a></li>');
        } else {
          $('#login-text').show();
          $('#loggedin-text').hide();
          $('#login-form').hide();
          $('#drawmode').css('display', 'none');
          $('#new-layer-menu').remove();
          $('#new-map-menu').remove();
        }
      }
  
      this.getUser = function () {
        return fbUser;
      };
  
      this.login = function (email, password) {
        if (!auth || !signInWithEmailAndPasswordFn) {
          return console.error("Firebase not initialized yet!");
        }
  
        signInWithEmailAndPasswordFn(auth, email, password)
          .catch((error) => {
            console.error("Login error:", error.message);
            alert("Login failed: " + error.message);
          });
      };
  
      this.logout = function () {
        if (!auth || !signOutFn) {
          return console.error("Firebase not initialized yet!");
        }
  
        signOutFn(auth).catch((error) => {
          console.error("Logout error:", error.message);
        });
      };
  
        this.getDb = function () {
      return db;
    };

    this.getAuth = function () {
      return auth;
    };

    this.getApp = function () {
      return app;
    };

    this.ref = function (path) {
      return refFn(db, path);
    };

    this.child = function (parentRef, childPath) {
      return childFn(parentRef, childPath);
    };

    this.update = function (ref, data) {
      return updateFn(ref, data);
    };
      // Init Firebase when module is created
      initFirebase();
  
      return this;
    }
  
    return FirebaseAuthModern;
  });
  