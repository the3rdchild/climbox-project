// navbar-user.js
// Usage: <script type="module"> import '/services/navbar-user.js' </script>

import * as FB from './firestore.js';

async function initNavbarUser(opts = {}) {
  const cfg = Object.assign({
    selectorAttr: 'data-user-link', // prefer elements that include this attribute
    fallbackHrefSignIn: '/pages/sign-in.html',
    profileHref: '/pages/profile.html',
    defaultAvatar: '/assets/img/profile.jpg' // fallback avatar path if needed
  }, opts);

  await FB.init();

  // find all candidate anchors where user link should live.
  // prefer anchors with data-user-link attribute; fallback to anchors that link to sign-in.html
  function findAnchors() {
    let els = Array.from(document.querySelectorAll(`a[${cfg.selectorAttr}]`));
    if (!els.length) {
      // fallback: anchors linking to sign-in.html (common pattern in your HTML)
      els = Array.from(document.querySelectorAll('a[href$="sign-in.html"], a[href$="/sign-in.html"], a[href$="../pages/sign-in.html"]'));
    }
    return els;
  }

  // set anchor content to avatar image + optional name tooltip
  function setAvatarOnAnchor(a, photoURL, displayName) {
    a.href = cfg.profileHref;
    a.title = displayName || 'Profile';
    // remove existing children
    a.innerHTML = '';
    // create img
    const img = document.createElement('img');
    img.className = 'navbar-user-avatar';
    img.src = photoURL || cfg.defaultAvatar;
    img.alt = displayName || 'User';
    // fallback if image fails: restore icon
    img.onerror = () => {
      // keep using icon fallback
      a.innerHTML = `<i class="material-symbols-rounded">account_circle</i>`;
      a.href = cfg.profileHref;
      a.title = displayName || 'Profile';
    };
    a.appendChild(img);
  }

  // set anchor to default icon (signed out)
  function setIconOnAnchor(a) {
    a.href = cfg.fallbackHrefSignIn;
    a.title = 'Sign in';
    a.innerHTML = `<i class="material-symbols-rounded">account_circle</i>`;
  }

  // apply to all anchors
  function setAllToIcon() {
    const anchors = findAnchors();
    anchors.forEach(a => setIconOnAnchor(a));
  }

  // set all avatars when user is present
  async function setAllToAvatar(user) {
    const anchors = findAnchors();
    // try to get profile photo from Firestore profile doc (preferred)
    let photoURL = null;
    let displayName = (user && (user.displayName || user.email)) || '';
    try {
      const prof = await FB.getProfile(user.uid);
      if (prof) {
        if (prof.photoURL) photoURL = prof.photoURL;
        if (prof.name) displayName = prof.name;
      }
    } catch (e) { /* ignore */ }

    // prefer auth photoURL if Firestore absent
    if (!photoURL && user && user.photoURL) photoURL = user.photoURL;

    // if still no photo, use default avatar (or keep icon)
    anchors.forEach(a => {
      if (photoURL) setAvatarOnAnchor(a, photoURL, displayName);
      else {
        // If no photo, still show small circular initials fallback (optional)
        // For simplicity, use icon but with title
        a.href = cfg.profileHref;
        a.title = displayName || 'Profile';
        a.innerHTML = `<i class="material-symbols-rounded">account_circle</i>`;
      }
    });
  }

  // wire auth state changes
  FB.onAuthChange((user) => {
    try {
      const anchors = findAnchors();
      if (!anchors.length) return;
      if (!user) {
        setAllToIcon();
      } else {
        setAllToAvatar(user);
      }
    } catch (e) {
      console.warn('navbar-user init err', e);
    }
  });

  // initial set (in case auth not loaded immediately)
  setAllToIcon();
}

// auto-init on import
initNavbarUser().catch(e => { console.warn('navbar-user init failed', e); });
