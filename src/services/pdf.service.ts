import { withContext } from "./scraper/browser";

export async function htmlToPdf(html: string): Promise<Buffer> {
  return withContext(async (context) => {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({ format: "A4", landscape: true, printBackground: true, margin: { top: "12mm", right: "10mm", bottom: "12mm", left: "10mm" } });
    return Buffer.from(pdf);
  });
}
