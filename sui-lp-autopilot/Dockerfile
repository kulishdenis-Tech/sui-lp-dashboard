FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages ./packages
COPY vitest.config.ts tsconfig.base.json ./
RUN npm install
COPY . .
EXPOSE 5190
CMD ["npm", "run", "bot"]
