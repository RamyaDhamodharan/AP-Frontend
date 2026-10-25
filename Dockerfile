
FROM node:22-alpine AS build

WORKDIR /app

ARG VITE_AUTH_API_BASE_URL=http://localhost:8001
ARG VITE_AP_API_BASE_URL=http://localhost:8000

ENV VITE_AUTH_API_BASE_URL=$VITE_AUTH_API_BASE_URL
ENV VITE_AP_API_BASE_URL=$VITE_AP_API_BASE_URL

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
