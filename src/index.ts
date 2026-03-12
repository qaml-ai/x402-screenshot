import { Hono } from "hono";
import { cdpPaymentMiddleware } from "x402-cdp";
import { describeRoute, openAPIRouteHandler } from "hono-openapi";
import puppeteer from "@cloudflare/puppeteer";

const app = new Hono<{ Bindings: Env }>();

app.get("/.well-known/openapi.json", openAPIRouteHandler(app, {
  documentation: {
    info: {
      title: "x402 Screenshot Service",
      description: "Capture screenshots of any URL as PNG or PDF. Pay-per-use via x402 protocol on Base mainnet.",
      version: "1.0.0",
    },
    servers: [{ url: "https://screenshot.camelai.io" }],
  },
}));

app.use(
  cdpPaymentMiddleware(
    (env) => ({
      "GET /screenshot": {
        accepts: [
          {
            scheme: "exact",
            price: "$0.01",
            network: "eip155:8453",
            payTo: env.SERVER_ADDRESS as `0x${string}`,
          },
        ],
        description: "Capture a screenshot of any URL",
        mimeType: "image/png",
        extensions: {
          bazaar: {
            discoverable: true,
            inputSchema: {
              queryParams: {
                url: {
                  type: "string",
                  description: "URL to screenshot",
                  required: true,
                },
                format: {
                  type: "string",
                  description: "png or pdf",
                  required: false,
                },
              },
            },
          },
        },
      },
    })
  )
);

app.get("/screenshot", describeRoute({
  description: "Capture a screenshot of any URL. Returns PNG or PDF. Requires x402 payment ($0.01).",
  responses: {
    200: { description: "Screenshot image or PDF", content: { "image/png": { schema: { type: "string", format: "binary" } }, "application/pdf": { schema: { type: "string", format: "binary" } } } },
    400: { description: "Invalid or missing URL" },
    402: { description: "Payment required" },
    500: { description: "Screenshot failed" },
  },
}), async (c) => {
  const url = c.req.query("url");
  if (!url) {
    return c.json({ error: "Missing required query parameter: url" }, 400);
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    return c.json({ error: "Invalid URL" }, 400);
  }

  const format = (c.req.query("format") || "png").toLowerCase();
  if (format !== "png" && format !== "pdf") {
    return c.json({ error: "Format must be png or pdf" }, 400);
  }

  let browser;
  try {
    browser = await puppeteer.launch(c.env.BROWSER);
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });

    if (format === "pdf") {
      const pdf = await page.pdf({ format: "A4", printBackground: true });
      return new Response(pdf, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'inline; filename="screenshot.pdf"',
        },
      });
    }

    const screenshot = await page.screenshot({ fullPage: false });
    return new Response(screenshot, {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": 'inline; filename="screenshot.png"',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ error: "Screenshot failed", details: message }, 500);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

export default app;
