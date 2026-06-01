import { obtenerEstadoGuia } from "./src/services/scraper/courierbox.scraper.js";

async function main() {
  const tracking = process.argv[2];
  if (!tracking) {
    console.error("Por favor provee un numero de tracking.");
    process.exit(1);
  }

  try {
    console.log(`Iniciando scrape para: ${tracking}`);
    const result = await obtenerEstadoGuia(tracking);
    console.log("\n=== RESULTADO DEL SCRAPER ===");
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Error en scraper:", err);
  } finally {
    process.exit(0);
  }
}

main();
