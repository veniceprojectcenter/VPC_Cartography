define(['jquery'], function($) {
    function FirebaseAuthModern(config) {
      let auth;
      let fbUser = null;
      let loggedIn = false;
  
      // Firebase method placeholders
      let signInWithEmailAndPasswordFn;
      let signOutFn;
  
      async function initFirebase() {
        const [
          { initializeApp },
          { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged }
        ] = await Promise.all([
          import('https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js'),
          import('https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js'),
        ]);
  
        const app = initializeApp(config);
        auth = getAuth(app);
  
        // Save references for later use
        signInWithEmailAndPasswordFn = signInWithEmailAndPassword;
        signOutFn = signOut;
  
        onAuthStateChanged(auth, (user) => {
          fbUser = user;
          loggedIn = !!user;
          updateUI(user);
        });
      }
  
      function updateUI(user) {
        if (user) {
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
  
      // Init Firebase when module is created
      initFirebase();
  
      return this;
    }
  
    return FirebaseAuthModern;
  });
  