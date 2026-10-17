
FROM node:22-alpine AS build

WORKDIR /app

ARG VITE_AUTH_API_URL
ARG VITE_CORE_API_URL

ENV VITE_AUTH_API_URL=$VITE_AUTH_API_URL
ENV VITE_CORE_API_URL=$VITE_CORE_API_URL

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
