# Sightline demo

Type a web address and see the outline Sightline gives an AI agent, with and without `infer`, next to a screenshot. Live at https://sightline-demo-five.vercel.app (Vercel project `sightline-demo` in the Anam team).

- `public/` is the page: plain HTML, CSS and a small script.
- `api/read.ts` opens the address in headless Chrome (`@sparticuz/chromium` with `puppeteer-core`), runs Sightline twice and returns both outlines with a JPEG screenshot. It refuses non-public addresses, including after redirects, and gives up after 25 seconds of loading.
- `api/_sightline.ts` is generated from `../src` by `npm run bundle`. Run it after changing the library, then deploy with `vercel deploy --prod`.

To try the function locally, point `CHROME_PATH` at a Chrome binary; otherwise it uses the serverless Chromium build, which only runs on Linux.
