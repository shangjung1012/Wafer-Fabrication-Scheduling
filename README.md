This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Folder Structure & Division of Labor

This project uses a Feature-Sliced / Domain-Driven architecture to prepare for future microservice extraction. The modules are divided according to the team's functional assignments:

```text
wafer-fabrication-scheduling/
├── docker-compose.yml      # 定義 PostgreSQL, Redis 等本地開發依賴的容器服務
├── package.json            # 使用 pnpm 管理套件
├── prisma/                 # Prisma Schema 定義與 Migration
│   └── schema.prisma
└── src/
    ├── app/                # 1. Presentation Layer: Next.js App Router (UI & API)
    │   ├── api/            # API Controllers (對應 Spec 的 API)
    │   │   ├── auth/
    │   │   ├── orders/
    │   │   └── schedule/
    │   ├── (dashboard)/    # 需登入的後台頁面 (UI/Views)
    │   │   ├── orders/     # 業務/管理員檢視訂單介面
    │   │   └── schedule/   # 排程與衝突視覺化甘特圖
    │   ├── login/          # 登入註冊頁面
    │   ├── layout.tsx
    │   └── globals.css     # 包含 Tailwind 的基礎樣式
    │
    ├── modules/            # 2. Service Layer: 商業邏輯 (對應 Spec 的三大 Module)
    │   ├── auth/           # 權限、JWT、MFA 邏輯
    │   ├── orders/         # 訂單處理、插單申請邏輯
    │   └── schedule/       # 排程演算法、衝突偵測邏輯
    │
    ├── infra/              # 3. Persistence & Infra Layer: 基礎設施與資料層
    │   └── db/             # PostgreSQL 連線設定與 Prisma Client 實例
    │       └── client.ts
    │
    ├── components/         # 全域共用的 UI 元件 (Buttons, Tables, Charts 等)
    └── lib/                # 全域 Utility 函式 (格式化、共用常數等)
     
```

## Setup Database (PostgreSQL)

This project uses PostgreSQL as its database. You can easily start it locally using Docker.

1. Copy the example environment variables file:
   ```bash
   cp .env.example .env
   ```

2. Start the PostgreSQL database in the background:
   ```bash
   docker compose up -d
   ```

3. Run database migrations to push the schema:
   ```bash
   pnpm db:migrate
   ```

4. Generate the Prisma client:
   ```bash
   pnpm db:generate
   ```

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
