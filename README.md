## Quick start

/home/user/climbox-project/
`npm i`

Install Firebase CLI	`npm install -g firebase-tools`
Init Hosting	`firebase init hosting`
Preview locally	`firebase emulators:start --only hosting`
Open browser	`http://127.0.0.1:5000`

## Firebase Hosting Json Guide
```js
{
  "hosting": {
    "public": "public",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**"
    ],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  }
}
```

## File Structure

Within the download you'll find the following directories and files:

```
climbox-project
   ├── public
   │   ├── assets
   │   │   ├── data
   │   │   │   ├── thingspeak.js
   │   │   ├── css
   │   │   ├── fonts
   │   │   ├── img
   │   │   ├── js
   │   │   │   ├── core
   │   │   │   ├── plugins
   │   │   │   └── material-dashboard.js
   │   │   │   └── material-dashboard.js.map
   │   │   │   └── material-dashboard.min.js
   │   │   └── scss
   │   │       ├── material-dashboard
   │   │       └── material-dashboard.scss
   │   ├── pages
   │   │   ├── dashboard.html
   │   │   ├── map.html
   │   │   ├── notifications.html
   │   │   ├── profile.html
   │   │   ├── sign-in.html
   │   │   ├── sign-up.html
   │   │   ├── tables.html
   │   ├── index.html
   ├── .gitignore
   ├── gulpfile.mjs
   ├── README.md
```
