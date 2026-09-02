# ATS CLUB Inventory Management

## Install on a phone

This project is an installable Progressive Web App (PWA). Deploy it on an HTTPS domain, then open that domain on a phone.

- Android Chrome: sign in, tap the **Install ATS CLUB** banner, and choose **Install App**.
- iPhone Safari: sign in, tap **Share**, choose **Add to Home Screen**, and tap **Add**.

The app uses a service worker for the static application shell. Inventory, account, and other Supabase data still require an internet connection and are not cached.

## Local preview

Run `npm start`, then open the displayed local URL. Service workers and browser install prompts require HTTPS in production; `localhost` is also suitable for local testing.

## Deployment requirements

- Serve `index.html`, `app.js`, `manifest.webmanifest`, `sw.js`, and `favicon.svg` from the same HTTPS origin.
- Keep the service worker at the site root so it controls the whole app.
- Do not publish `.env` files or cache authenticated API responses.