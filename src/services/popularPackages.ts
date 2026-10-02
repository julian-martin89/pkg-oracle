import type { Ecosystem } from "../types.js";

/**
 * Curated shortlist of the npm, PyPI, and crates.io packages most worth impersonating.
 *
 * Honest scope note: this is not a live top-1000-by-download-count feed —
 * fetching and re-ranking that from the npm/PyPI download-count APIs on
 * every request (or even on a cron) is future work (see README). What's
 * embedded here are the highest-value, highest-traffic package names in
 * each ecosystem — the ones an attacker would most want a coding agent to
 * mistype (`expres`, `reqeusts`, `numpyy`, ...). For the typosquat check,
 * what matters is coverage of *targets worth spoofing*, not exhaustive
 * rank-1000 completeness, so this list is deliberately weighted toward
 * exactly that.
 */

export const POPULAR_NPM_PACKAGES: readonly string[] = [
  "react", "react-dom", "vue", "angular", "svelte", "next", "nuxt", "gatsby",
  "express", "koa", "fastify", "hapi", "nest", "@nestjs/core", "socket.io",
  "lodash", "underscore", "ramda", "moment", "dayjs", "date-fns", "luxon",
  "axios", "node-fetch", "got", "superagent", "request", "isomorphic-fetch",
  "webpack", "rollup", "vite", "parcel", "esbuild", "swc", "babel-core",
  "@babel/core", "@babel/preset-env", "typescript", "ts-node", "tsx",
  "eslint", "prettier", "stylelint", "husky", "lint-staged",
  "jest", "mocha", "chai", "vitest", "jasmine", "ava", "tape", "sinon",
  "cypress", "playwright", "puppeteer", "selenium-webdriver", "webdriverio",
  "chalk", "commander", "yargs", "inquirer", "ora", "boxen", "figlet",
  "dotenv", "cross-env", "config", "convict", "nconf",
  "uuid", "nanoid", "shortid", "cuid",
  "bcrypt", "bcryptjs", "jsonwebtoken", "passport", "passport-jwt",
  "helmet", "cors", "morgan", "body-parser", "cookie-parser", "compression",
  "multer", "express-rate-limit", "express-session",
  "mongoose", "sequelize", "typeorm", "prisma", "knex", "pg", "mysql2",
  "sqlite3", "redis", "ioredis", "memcached",
  "socket.io-client", "ws", "engine.io",
  "graphql", "apollo-server", "@apollo/client", "graphql-tag",
  "rxjs", "immutable", "immer", "redux", "react-redux", "@reduxjs/toolkit",
  "mobx", "zustand", "recoil", "jotai", "xstate",
  "styled-components", "emotion", "tailwindcss", "postcss", "autoprefixer",
  "sass", "less", "stylus",
  "webpack-cli", "webpack-dev-server", "html-webpack-plugin",
  "core-js", "regenerator-runtime", "whatwg-fetch",
  "jquery", "bootstrap", "popper.js", "@popperjs/core",
  "three", "d3", "chart.js", "leaflet", "mapbox-gl",
  "sharp", "jimp", "canvas", "pdfkit", "puppeteer-core",
  "archiver", "adm-zip", "tar", "yauzl", "fs-extra", "glob", "rimraf",
  "mkdirp", "chokidar", "globby", "fast-glob",
  "semver", "minimist", "yargs-parser", "cli-table3", "cli-progress",
  "winston", "pino", "bunyan", "debug", "log4js",
  "joi", "zod", "yup", "ajv", "class-validator", "class-transformer",
  "async", "bluebird", "p-limit", "p-queue", "p-map",
  "eventemitter3", "mitt", "tiny-emitter",
  "react-router-dom", "react-router", "vue-router", "@angular/router",
  "vuex", "pinia", "@ngrx/store",
  "next-auth", "clerk", "firebase", "firebase-admin", "aws-sdk",
  "@aws-sdk/client-s3", "@aws-sdk/client-dynamodb", "googleapis",
  "stripe", "@stripe/stripe-js", "twilio", "sendgrid", "@sendgrid/mail",
  "nodemailer", "mailgun-js",
  "openai", "@anthropic-ai/sdk", "langchain", "@modelcontextprotocol/sdk",
  "electron", "electron-builder", "react-native", "expo",
  "vue-cli", "@vue/cli", "create-react-app", "vite-plugin-react",
  "husky", "commitizen", "standard-version", "semantic-release",
  "npm", "yarn", "pnpm", "nx", "lerna", "turborepo",
  "protobufjs", "grpc", "@grpc/grpc-js", "thrift",
  "crypto-js", "node-forge", "tweetnacl", "elliptic",
  "validator", "sanitize-html", "xss", "dompurify",
  "moment-timezone", "cron", "node-cron", "agenda", "bull", "bullmq",
  "vue-i18n", "i18next", "react-i18next", "formatjs",
  "react-hook-form", "formik", "final-form",
  "swr", "react-query", "@tanstack/react-query",
  "framer-motion", "gsap", "lottie-web", "react-spring",
  "next-themes", "next-seo", "next-sitemap",
] as const;

export const POPULAR_PYPI_PACKAGES: readonly string[] = [
  "requests", "urllib3", "httpx", "aiohttp", "certifi", "charset-normalizer",
  "idna", "six", "setuptools", "wheel", "pip", "packaging",
  "numpy", "pandas", "scipy", "scikit-learn", "matplotlib", "seaborn",
  "plotly", "statsmodels", "sympy",
  "torch", "tensorflow", "keras", "jax", "xgboost", "lightgbm", "catboost",
  "transformers", "datasets", "tokenizers", "accelerate", "diffusers",
  "flask", "django", "fastapi", "starlette", "uvicorn", "gunicorn",
  "tornado", "bottle", "pyramid", "sanic", "aiohttp-jinja2",
  "sqlalchemy", "alembic", "psycopg2", "psycopg2-binary", "pymysql",
  "pymongo", "redis", "celery", "kombu", "billiard",
  "jinja2", "markupsafe", "click", "typer", "rich", "colorama",
  "pyyaml", "toml", "python-dotenv", "configparser",
  "cryptography", "pyopenssl", "pyjwt", "passlib", "bcrypt", "argon2-cffi",
  "boto3", "botocore", "s3transfer", "google-cloud-storage", "azure-storage-blob",
  "pillow", "opencv-python", "imageio", "scikit-image",
  "beautifulsoup4", "lxml", "html5lib", "scrapy", "selenium",
  "pytest", "pytest-cov", "pytest-asyncio", "tox", "nose", "coverage",
  "mypy", "black", "flake8", "pylint", "isort", "ruff", "bandit",
  "attrs", "pydantic", "pydantic-core", "marshmallow", "cattrs",
  "python-dateutil", "pytz", "tzdata", "arrow", "pendulum",
  "click-plugins", "cachetools", "tenacity", "backoff", "retrying",
  "gevent", "eventlet", "greenlet", "trio", "anyio",
  "grpcio", "protobuf", "thrift",
  "jsonschema", "referencing", "rpds-py", "jsonpatch",
  "openai", "anthropic", "langchain", "langchain-core", "llama-index",
  "huggingface-hub", "sentence-transformers", "spacy", "nltk", "gensim",
  "networkx", "pyparsing", "wrapt", "decorator", "typing-extensions",
  "importlib-metadata", "zipp", "platformdirs", "filelock",
  "requests-oauthlib", "oauthlib", "authlib",
  "docutils", "sphinx", "mkdocs", "mkdocs-material",
  "gunicorn", "waitress", "gevent-websocket", "websockets",
  "pyzmq", "msgpack", "cloudpickle", "dill",
  "numba", "cython", "cffi", "pycparser",
  "psutil", "distro", "py-cpuinfo",
  "google-api-python-client", "google-auth", "google-auth-oauthlib",
  "azure-identity", "azure-core", "msal",
  "pyarrow", "fastparquet", "openpyxl", "xlrd", "xlsxwriter",
  "streamlit", "gradio", "dash", "bokeh",
  "docker", "kubernetes", "paramiko", "fabric", "invoke",
] as const;

export const POPULAR_CRATES: readonly string[] = [
  "serde", "serde_json", "serde_yaml", "tokio", "tokio-util", "tokio-stream",
  "clap", "clap_derive", "structopt", "rand", "rand_core", "getrandom",
  "regex", "regex-syntax", "reqwest", "hyper", "hyper-util", "http", "url",
  "actix-web", "actix-rt", "axum", "warp", "rocket", "tower", "tower-http",
  "diesel", "sqlx", "sea-orm", "rusqlite", "postgres", "mongodb",
  "anyhow", "thiserror", "eyre", "color-eyre",
  "log", "env_logger", "tracing", "tracing-subscriber", "tracing-futures",
  "futures", "futures-util", "futures-core", "async-trait", "async-std",
  "syn", "quote", "proc-macro2", "itertools", "either",
  "chrono", "time", "uuid", "base64", "hex", "sha2", "md5", "blake3",
  "bytes", "crossbeam", "crossbeam-channel", "rayon", "once_cell",
  "lazy_static", "parking_lot", "dashmap", "indexmap", "bitflags",
  "num", "num-traits", "num-derive", "nom", "pest", "lalrpop",
  "winit", "wgpu", "bevy", "glium", "ggez",
  "cookie", "jsonwebtoken", "ring", "rustls", "rustls-pemfile", "openssl",
  "native-tls", "tungstenite", "tokio-tungstenite", "prost", "tonic",
  "config", "dotenv", "dotenvy", "toml", "csv", "walkdir", "glob",
  "tempfile", "assert_cmd", "criterion", "proptest", "mockall",
  "wasm-bindgen", "js-sys", "web-sys", "libc", "cc", "bindgen", "cbindgen",
  "byteorder", "memchr", "aho-corasick", "unicode-segmentation",
  "smallvec", "arrayvec", "slab", "petgraph", "image", "plotters",
  "clippy", "rustfmt", "cargo-edit", "cargo-watch",
] as const;

const npmSet = new Set<string>(POPULAR_NPM_PACKAGES.map((p) => p.toLowerCase()));
const pypiSet = new Set<string>(POPULAR_PYPI_PACKAGES.map((p) => p.toLowerCase()));
const cratesSet = new Set<string>(POPULAR_CRATES.map((p) => p.toLowerCase()));

function listFor(ecosystem: Ecosystem): readonly string[] {
  if (ecosystem === "npm") return POPULAR_NPM_PACKAGES;
  if (ecosystem === "crates.io") return POPULAR_CRATES;
  return POPULAR_PYPI_PACKAGES;
}

function setFor(ecosystem: Ecosystem): ReadonlySet<string> {
  if (ecosystem === "npm") return npmSet;
  if (ecosystem === "crates.io") return cratesSet;
  return pypiSet;
}

export function isKnownPopular(ecosystem: Ecosystem, name: string): boolean {
  return setFor(ecosystem).has(name.toLowerCase());
}

export function getPopularList(ecosystem: Ecosystem): readonly string[] {
  return listFor(ecosystem);
}
