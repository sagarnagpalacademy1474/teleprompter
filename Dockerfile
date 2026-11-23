# Teleprompter app for Google Cloud Run: static files served by nginx on port 8080.
FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY app/ /usr/share/nginx/html/
RUN rm -f /usr/share/nginx/html/test-*.js
EXPOSE 8080
