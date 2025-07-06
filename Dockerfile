# Use an official Node.js runtime as a parent image.
# 'alpine' variants are smaller and good for production.
FROM node:lts-alpine

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to leverage Docker's layer caching.
# If these files haven't changed, Docker won't reinstall dependencies.
COPY package*.json ./

# Install app dependencies. Using 'ci' is recommended for reproducible builds.
# --only=production ensures we don't install devDependencies.
RUN npm ci --only=production

# Copy the rest of your application's source code
COPY . .

# Your server listens on port 3000
EXPOSE 3000

# The command to run your application
CMD [ "node", "server/server.js" ]