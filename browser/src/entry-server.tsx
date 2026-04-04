// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server";

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link rel="icon" href="/favicon.ico" />
          {/* <link rel="manifest" href="/manifest.webmanifest" /> */}
          <meta name="theme-color" content="#a855f7" />
          <meta name="mobile-web-app-capable" content="yes" />
          <meta
            name="apple-mobile-web-app-status-bar-style"
            content="black-translucent"
          />
          <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
          {assets}
        </head>
        <body>
          <div id="app">{children}</div>
          {scripts}
          {/* <script src="/registerSW.js" /> */}
        </body>
      </html>
    )}
  />
));
