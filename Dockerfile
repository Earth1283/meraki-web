FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html styles.css /usr/share/nginx/html/
COPY styles /usr/share/nginx/html/styles
COPY src /usr/share/nginx/html/src
EXPOSE 80
