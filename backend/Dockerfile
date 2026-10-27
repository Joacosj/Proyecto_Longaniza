FROM denoland/deno:2.9.6
WORKDIR /app
COPY deno.json deno.lock* ./
COPY src ./src
RUN deno cache src/main.ts src/db/migrate.ts
EXPOSE 8000
CMD ["sh", "-c", "deno task migrate && deno task start"]
