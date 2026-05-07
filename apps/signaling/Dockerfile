FROM node:18-alpine
WORKDIR /app

# copy package files and workspace packages needed for build
COPY package.json package-lock.json ./
COPY apps/signaling ./apps/signaling
COPY packages/shared ./packages/shared

RUN npm ci --production
RUN npm run build -w @ultimate-meet/signaling

ENV SIGNALING_PORT=8080
ENV JWT_SECRET=
EXPOSE 8080
CMD ["node", "apps/signaling/dist/server.js"]
