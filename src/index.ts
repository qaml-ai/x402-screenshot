import { Hono } from "hono";
import { cdpPaymentMiddleware } from "x402-cdp";
import { stripeApiKeyMiddleware } from "x402-stripe";
import { openapiFromMiddleware } from "x402-openapi";
import puppeteer from "@cloudflare/puppeteer";

const app = new Hono<{ Bindings: Env }>();

const ROUTES = {
  "POST /": {
    accepts: [
      { scheme: "exact", price: "$0.01", network: "eip155:8453", payTo: "0x0" as `0x${string}` },
      { scheme: "exact", price: "$0.01", network: "eip155:137", payTo: "0x0" as `0x${string}` },
      { scheme: "exact", price: "$0.01", network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", payTo: "CvraJ4avKPpJNLvMhMH5ip2ihdt85PXvDwfzXdziUxRq" },
    ],
    description: "Capture a screenshot of any URL. Send {\"url\": \"https://example.com\"}",
    mimeType: "image/png",
    extensions: {
      bazaar: {
        info: {
          input: {
            type: "http",
            method: "POST",
            bodyType: "json",
            body: {
              url: { type: "string", description: "The URL to screenshot", required: true },
              format: { type: "string", description: "Output format: png (default) or pdf", required: false },
            },
          },
          output: { type: "raw" },
        },
        schema: {
          properties: {
            input: {
              properties: { method: { type: "string", enum: ["POST"] } },
              required: ["method"],
            },
          },
        },
      },
    },
  },
};

app.use(stripeApiKeyMiddleware({ serviceName: "screenshot" }));

app.use(async (c, next) => {
  if (c.get("skipX402")) return next();
  return cdpPaymentMiddleware((env) => ({
    "POST /": { ...ROUTES["POST /"], accepts: ROUTES["POST /"].accepts.map((a: any) => ({ ...a, payTo: a.network.startsWith("solana") ? a.payTo : env.SERVER_ADDRESS as `0x${string}` })) },
  }))(c, next);
});

app.post("/", async (c) => {
  const body = await c.req.json<{ url?: string; format?: string }>();
  if (!body?.url) {
    return c.json({ error: "Missing 'url' field" }, 400);
  }
  const url = body.url.trim();

  try {
    new URL(url);
  } catch {
    return c.json({ error: "Invalid URL" }, 400);
  }

  const format = (body.format || "png").toLowerCase();
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

app.get("/.well-known/openapi.json", openapiFromMiddleware("x402 Screenshot", "screenshot.camelai.io", ROUTES));

app.get("/", (c) => {
  return new Response('# screenshot.camelai.io \\u2014 Screenshot\n\nCapture website screenshots.\n\nPart of [camelai.io](https://camelai.io).\n\n## API\n\n\\`POST /\\` \\u2014 $0.01 per request\n\n**Body:** `{"url": "https://example.com", "format": "png"}`\n\n**Response:** PNG or PDF image\n\n## Payment\n\nAccepts USDC on Base, Polygon, or Solana via x402. Or use a Stripe API key (\\`Authorization: Bearer sk_camel_...\\`).\n\nSee [camelai.io](https://camelai.io) for payment setup and full service list.', {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
});

export default app;
