/** Génère docs/openapi.json depuis les schémas zod. Usage : npm run docs:openapi */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildOpenApi } from "../src/server/openapi";

const target = path.resolve(__dirname, "../docs/openapi.json");
writeFileSync(target, `${JSON.stringify(buildOpenApi(), null, 2)}\n`, "utf8");
console.log(`Écrit : ${target}`);
