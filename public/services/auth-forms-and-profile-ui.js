// /public/services/auth-forms-and-profile-ui.js
// Wires sign-up & sign-in forms and updates profile UI after login.
// Usage: include AFTER auth-ui.js and firestore-and-profile.js
// <script type="module" src="/services/auth-forms-and-profile-ui.js"></script>

// This module expects these globals to exist (created in firestore-and-profile.js & auth-ui.js):
//  - window.climboxSignUp({displayName, contact, password}) -> creates user and user doc
//  - window.climboxSignIn({identifier, password}) -> signs in (flexible by email/phone/name)
//  - window.climboxMountProfileUI() -> mounts profile lists (emails, phones, locations)
//  - window.climboxAuth.getCurrentUserMeta() -> returns { uid, email, displayName, photoURL }

(function () {
    // ---------- Helper UI functions ----------
    function $(sel) { return document.querySelector(sel); }
    function showBtnLoading(btn, loading = true) {
      if (!btn) return;
      if (loading) {
        btn.dataset.orig = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Loading';
      } else {
        btn.disabled = false;
        if (btn.dataset.orig) btn.innerHTML = btn.dataset.orig;
      }
    }
  
    // ---------- Sign Up ----------
    async function wireSignUp() {
      const btn = $('#signup-btn');
      if (!btn) return;
      btn.addEventListener('click', async (e) => {
        const nameEl = $('#signup-name');
        const emailEl = $('#signup-email');
        const pwEl = $('#signup-password');
        const name = nameEl?.value?.trim();
        const contact = emailEl?.value?.trim();
        const password = pwEl?.value;
  
        if (!name || !contact || !password) {
          alert('Isi semua field: nama, email/WA, dan password.');
          return;
        }
  
        showBtnLoading(btn, true);
        try {
          await window.climboxSignUp({ displayName: name, contact, password });
          // signup signs user in; redirect to profile
          location.href = '/pages/profile.html';
        } catch (err) {
          console.error(err);
          alert(err?.message || 'Signup gagal');
        } finally {
          showBtnLoading(btn, false);
        }
      });
    }
  
    // ---------- Sign In ----------
    async function wireSignIn() {
      const btn = $('#signin-btn');
      if (!btn) return;
      btn.addEventListener('click', async (e) => {
        const idEl = $('#signin-email');
        const pwEl = $('#signin-password');
        const rememberEl = $('#signin-remember');
        const identifier = idEl?.value?.trim();
        const password = pwEl?.value;
  
        if (!identifier || !password) {
          alert('Isi identifier (email/name/WA) dan password.');
          return;
        }
  
        showBtnLoading(btn, true);
        try {
          await window.climboxSignIn({ identifier, password });
          location.href = '/pages/profile.html';
        } catch (err) {
          console.error(err);
          alert(err?.message || 'Login gagal');
        } finally {
          showBtnLoading(btn, false);
        }
      });
    }
  
// ---------- Profile UI (avatar + header + mount lists) ----------
function wireProfileUI() {
    // run only on profile page
    if (!location.pathname.includes('/profile.html') && !location.pathname.endsWith('/profile')) return;

    // Update avatar image and user info
    const meta = window.climboxAuth?.getCurrentUserMeta?.() || null; // Perbaikan di sini
    if (!meta) {
        console.warn('No user meta in profile UI');
        return;
    }

    // avatar image element (selector based on your snippet)
    const avatarImg = document.querySelector('.avatar.avatar-xl.position-relative img');
    if (avatarImg) {
        // prefer photoURL, otherwise use local userloggedin.png if present
        avatarImg.src = meta.photoURL || '/assets/img/userloggedin.png';
        avatarImg.alt = meta.displayName || meta.email || 'User ';
    }

    // Update user info in the profile
    const userInfoBlock = document.querySelector('.col-auto.my-auto .h-100');
    if (userInfoBlock) {
        // replace content with name and status
        const display = meta.displayName || meta.email || 'Pengguna';
        userInfoBlock.innerHTML = `
            <a>
                <h5 class="mb-1">${display} [Terdaftar]</h5>
            </a>
            <p class="mb-0 font-weight-normal text-sm">
                ${meta.email || 'Climbox Antusias'}
            </p>
        `;
    }

    // mount profile lists (emails, phones, locations)
    if (typeof window.climboxMountProfileUI === 'function') {
        // call after a tick so DOM updates applied
        setTimeout(() => window.climboxMountProfileUI(), 50);
    }

    // attach sign out button if any
    const btnSignOut = document.querySelector('[data-action="signout"]');
    if (btnSignOut) {
        btnSignOut.addEventListener('click', () => window.climboxAuth?.signOut());
    }
}

// ---------- Init wiring on DOM ready ----------
document.addEventListener('DOMContentLoaded', () => {
    // wire forms if present
    wireSignUp();
    wireSignIn();
    wireProfileUI();
});

  
    // ---------- Init wiring on DOM ready ----------
    document.addEventListener('DOMContentLoaded', () => {
      // wire forms if present
      wireSignUp();
      wireSignIn();
      wireProfileUI();
    });
  })();
  