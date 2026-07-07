import "reflect-metadata";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Weather agent API listening on http://localhost:${port}`);
  console.log(
    `Try: curl -XPOST localhost:${port}/agent/t1 -H 'content-type: application/json' -d '{"message":"what is the weather in berlin?"}'`,
  );
}

void bootstrap();
