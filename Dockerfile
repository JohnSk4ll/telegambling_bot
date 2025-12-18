FROM node:18-alpine

WORKDIR /app

# Install dependencies first (use package*.json to support package-lock)
COPY package*.json ./
RUN npm install --production

# Copy app source
COPY . .

ENV NODE_ENV=production

EXPOSE 5051

CMD ["node", "src/index.js"]
