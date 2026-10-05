import { z } from "zod";

const productUrl = "https://damsonmadder.com/products/liu-raincoat-navy-check";
const endpoint = `${productUrl}.js`;

const VARIANT_ID = 55927792337283;

const secondMS = 1000;

const checkIntervalMS = 60 * secondMS;
const maxBackoffMS = 10 * 60 * secondMS;
const jitterMS = 10 * secondMS;
const requestTimeoutMS = 10 * secondMS;
const maxConsecutiveFailures = 10;

const productSchema = z.object({
  variants: z.array(
    z.object({
      id: z.number(),
      public_title: z.string(),
      available: z.boolean(),
    })
  ),
});

const NTFY_TOPIC = process.env.NTFY_TOPIC;

if (!NTFY_TOPIC) {
  console.error("Set NTFY_TOPIC to your ntfy.sh topic name");
  process.exit(1);
}

// Errors that retrying won't fix, e.g. a misconfigured variant ID
class FatalError extends Error {}

async function notify(
  title: string,
  message: string,
  { priority = "urgent", tags = "tada" } = {}
) {
  const response = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
    method: "POST",
    body: message,
    headers: {
      Title: title,
      Priority: priority,
      Tags: tags,
      Click: productUrl,
    },
    signal: AbortSignal.timeout(requestTimeoutMS),
  });

  if (!response.ok) {
    throw new Error(`ntfy HTTP ${response.status}`);
  }
}

async function notifyBroken(reason: string) {
  try {
    await notify("Stock checker stopped", reason, {
      priority: "high",
      tags: "warning",
    });
  } catch (error) {
    console.error("Failed to send failure notification:", error);
  }
}

async function checkStock() {
  // Cache-busting param so Shopify's CDN doesn't serve a stale response
  const response = await fetch(`${endpoint}?_=${Date.now()}`, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(requestTimeoutMS),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const product = productSchema.parse(await response.json());

  const variant = product.variants.find(variant => variant.id === VARIANT_ID);

  if (!variant) {
    throw new FatalError(`Variant ${VARIANT_ID} not found on ${productUrl}`);
  }

  console.log(
    new Date().toLocaleString(),
    variant.public_title,
    variant.available ? "🟢 IN STOCK" : "🔴 OUT OF STOCK"
  );

  return { available: variant.available, title: variant.public_title };
}

// Doubles the interval for each consecutive failure, capped, plus random jitter
function nextDelay(consecutiveFailures: number) {
  const base = Math.min(
    checkIntervalMS * 2 ** consecutiveFailures,
    maxBackoffMS
  );

  return base + Math.random() * jitterMS;
}

async function main() {
  let consecutiveFailures = 0;

  while (true) {
    try {
      const { available, title } = await checkStock();

      if (available) {
        console.log("🎉 IT'S BACK IN STOCK!");
        await notify("Back in stock!", `Liu Raincoat ${title} is available`);
        return;
      }

      consecutiveFailures = 0;
    } catch (error) {
      console.error("Check failed:", error);

      if (error instanceof FatalError) {
        await notifyBroken(error.message);
        process.exit(1);
      }

      consecutiveFailures++;

      if (consecutiveFailures >= maxConsecutiveFailures) {
        await notifyBroken(
          `${consecutiveFailures} consecutive failures. Last error: ${error}`
        );
        process.exit(1);
      }
    }

    await new Promise(resolve =>
      setTimeout(resolve, nextDelay(consecutiveFailures))
    );
  }
}

main();
