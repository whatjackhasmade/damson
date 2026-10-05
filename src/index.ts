const productUrl = "https://damsonmadder.com/products/liu-raincoat-navy-check";
const endpoint = `${productUrl}.js`;

const VARIANT_ID = 55927792337283;

const NTFY_TOPIC = process.env.NTFY_TOPIC;

if (!NTFY_TOPIC) {
  console.error("Set NTFY_TOPIC to your ntfy.sh topic name");
  process.exit(1);
}

async function notify(title: string, message: string) {
  const response = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
    method: "POST",
    body: message,
    headers: {
      Title: title,
      Priority: "urgent",
      Tags: "tada",
      Click: productUrl,
    },
  });

  if (!response.ok) {
    throw new Error(`ntfy HTTP ${response.status}`);
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
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const product = await response.json();

  const variant = product.variants.find(
    (v: { id: number }) => v.id === VARIANT_ID
  );

  if (!variant) {
    throw new Error("Variant not found");
  }

  console.log(
    new Date().toLocaleString(),
    variant.public_title,
    variant.available ? "🟢 IN STOCK" : "🔴 OUT OF STOCK"
  );

  return { available: variant.available as boolean, title: variant.public_title as string };
}

async function main() {
  let wasInStock = false;

  while (true) {
    try {
      const { available, title } = await checkStock();

      // Alert on every out → in transition, so quick sell-out/restock cycles aren't missed
      if (available && !wasInStock) {
        console.log("🎉 IT'S BACK IN STOCK!");
        await notify("Back in stock!", `Liu Raincoat ${title} is available`);
      }

      wasInStock = available;
    } catch (error) {
      console.error("Check failed:", error);
    }

    // Check every 60 seconds
    await new Promise(resolve => setTimeout(resolve, 60_000));
  }
}

main();
