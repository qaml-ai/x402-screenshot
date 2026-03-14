import { Hono } from "hono";
import { cdpPaymentMiddleware } from "x402-cdp";
import { extractParams } from "x402-ai";
import { openapiFromMiddleware } from "x402-openapi";
import puppeteer from "@cloudflare/puppeteer";

const app = new Hono<{ Bindings: Env }>();

const SYSTEM_PROMPT = `You are a parameter extractor for a screenshot capture service.
Extract the following from the user's message and return JSON:
- "url": the URL to screenshot (required)
- "format": "png" or "pdf", default "png" (optional)

Return ONLY valid JSON, no explanation.
Examples:
- {"url": "https://example.com"}
- {"url": "https://example.com", "format": "pdf"}`;

const ROUTES = {
  "POST /": {
    accepts: [{ scheme: "exact", price: "$0.01", network: "eip155:8453", payTo: "0x0" as `0x${string}` }],
    description: "Capture a screenshot of any URL. Send {\"input\": \"your request\"}",
    mimeType: "image/png",
    extensions: {
      bazaar: {
        info: {
          input: {
            type: "http",
            method: "POST",
            bodyType: "json",
            body: {
              input: { type: "string", description: "Describe the URL to screenshot and optional format (png or pdf)", required: true },
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

app.use(
  cdpPaymentMiddleware((env) => ({
    "POST /": { ...ROUTES["POST /"], accepts: [{ ...ROUTES["POST /"].accepts[0], payTo: env.SERVER_ADDRESS as `0x${string}` }] },
  }))
);

app.post("/", async (c) => {
  const body = await c.req.json<{ input?: string }>();
  if (!body?.input) {
    return c.json({ error: "Missing 'input' field" }, 400);
  }

  const params = await extractParams(c.env.CF_GATEWAY_TOKEN, SYSTEM_PROMPT, body.input);
  const url = params.url as string;
  if (!url) {
    return c.json({ error: "Could not determine URL to screenshot" }, 400);
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    return c.json({ error: "Invalid URL" }, 400);
  }

  const format = ((params.format as string) || "png").toLowerCase();
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
  return c.json({
    service: "x402-screenshot",
    description: "Capture screenshots of any URL as PNG or PDF. Send POST / with {\"input\": \"screenshot https://example.com\"}",
    price: "$0.01 per request (Base mainnet)",
  });
});

export default app;
