'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Database,
  Lock,
  Cpu,
  HardDrive,
  Radio,
  Sparkles,
  ArrowRight,
  Check,
  Copy,
  Terminal,
  Layers,
  Shield,
  Zap,
  Code2,
  ChevronRight,
  ExternalLink,
  Github,
  Globe,
  Server,
  Cloud,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';

function SkyNodeLogo({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center rounded-lg bg-emerald-500 text-black font-black p-1 shadow-md shadow-emerald-500/20 ${className}`}>
      <Zap className="h-full w-full fill-current" />
    </div>
  );
}

function GithubIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}

const CODE_EXAMPLES = {
  javascript: {
    title: 'Client SDK (JavaScript)',
    language: 'javascript',
    code: `import { createClient } from '@skynode/client';

// Initialize SkyNode client with project ref and anon key
const skynode = createClient(
  'https://api.skynode.cloud/mohamed-ahmed',
  'skynode_anon_eyJhbGciOiJIUzI1Ni...'
);

// 1. Query records with PostgREST-style filtering
const { data: products, error } = await skynode
  .from('products')
  .select('id, name, price, stock')
  .gte('price', 50)
  .order('created_at', { ascending: false });

// 2. Realtime subscription to new rows
skynode
  .channel('public:orders')
  .on('INSERT', (payload) => console.log('New order received:', payload.new))
  .subscribe();`,
  },
  rest: {
    title: 'REST API Gateway',
    language: 'bash',
    code: `# Fetch high-rated items with query params
curl -X GET 'http://localhost:4000/api/v1/projects/mohamed-ahmed/gateway/products?price=gte.50&order=created_at.desc&limit=10' \\
  -H 'apikey: skynode_anon_key' \\
  -H 'Authorization: Bearer skynode_anon_key'

# Insert a new record
curl -X POST 'http://localhost:4000/api/v1/projects/mohamed-ahmed/gateway/products' \\
  -H 'apikey: skynode_anon_key' \\
  -H 'Content-Type: application/json' \\
  -d '{"name": "Developer Pro Laptop", "price": 1299.99, "stock": 42}'`,
  },
  sql: {
    title: 'PostgreSQL Schema & RLS',
    language: 'sql',
    code: `-- Enable Row Level Security
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Allow public read access to active products
CREATE POLICY "Public read products"
  ON products FOR SELECT
  USING (status = 'active');

-- Allow authenticated users to manage their own orders
CREATE POLICY "Users view own orders"
  ON store_orders FOR ALL
  TO authenticated
  USING (user_id = auth.uid());`,
  },
  realtime: {
    title: 'Realtime WebSockets',
    language: 'javascript',
    code: `const ws = new WebSocket('ws://localhost:4000/realtime?ref=mohamed-ahmed');

ws.onopen = () => {
  // Join realtime room
  ws.send(JSON.stringify({
    event: 'join',
    topic: 'realtime:mohamed-ahmed'
  }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  console.log('Realtime DB Event:', msg.table, msg.eventType, msg.record);
};`,
  },
};

export default function LandingPage() {
  const [activeCodeTab, setActiveCodeTab] = React.useState<keyof typeof CODE_EXAMPLES>('javascript');
  const [copied, setCopied] = React.useState(false);
  const [isLoggedIn, setIsLoggedIn] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    // Check if user is currently signed in
    api.get('/api/v1/auth/me').then((res) => {
      setIsLoggedIn(res.success && !!res.data);
    });
  }, []);

  function handleCopy() {
    navigator.clipboard.writeText(CODE_EXAMPLES[activeCodeTab].code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="min-h-screen bg-[#121212] text-[#ededed] selection:bg-emerald-500 selection:text-black">
      {/* Top Banner Notice */}
      <div className="border-b border-white/5 bg-gradient-to-r from-emerald-950/40 via-black to-emerald-950/40 py-2 px-4 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
        <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400 border border-emerald-500/20">
          New
        </span>
        <span>SkyNode Cloud 2.0 with Row Level Security and Realtime WebSockets is now live.</span>
        <Link href="/register" className="text-emerald-400 hover:text-emerald-300 font-medium inline-flex items-center gap-1">
          Explore now <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      {/* Navigation Header */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-[#121212]/80 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Logo & Main Nav */}
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2.5 group">
              <SkyNodeLogo className="h-7 w-7 transition-transform group-hover:scale-105" />
              <span className="font-bold text-lg tracking-tight text-white flex items-center gap-1">
                skynode<span className="text-emerald-500">.cloud</span>
              </span>
            </Link>

            <nav className="hidden md:flex items-center gap-6 text-sm text-[#a1a1a1]">
              <Link href="#features" className="hover:text-white transition-colors">
                Product
              </Link>
              <Link href="#code-showcase" className="hover:text-white transition-colors">
                Developers
              </Link>
              <Link href="#features" className="hover:text-white transition-colors">
                Solutions
              </Link>
              <Link href="#pricing" className="hover:text-white transition-colors">
                Pricing
              </Link>
              <Link href="#docs" className="hover:text-white transition-colors">
                Docs
              </Link>
            </nav>
          </div>

          {/* Right Header Controls */}
          <div className="flex items-center gap-3">
            {/* GitHub Stars */}
            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-white transition-colors"
            >
              <GithubIcon className="h-3.5 w-3.5" />
              <span>GitHub</span>
              <span className="text-muted-foreground border-l border-white/10 pl-1.5">★ 12.8k</span>
            </a>

            {/* Auth CTA buttons */}
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="text-sm font-medium text-[#a1a1a1] hover:text-white px-3 py-1.5 rounded-md hover:bg-white/5 transition-colors"
              >
                Sign in
              </Link>
              {isLoggedIn ? (
                <Link href="/projects">
                  <Button className="bg-emerald-500 hover:bg-emerald-600 text-black font-semibold text-sm px-4 h-9 shadow-sm shadow-emerald-500/20">
                    Dashboard
                  </Button>
                </Link>
              ) : (
                <Link href="/register">
                  <Button className="bg-emerald-500 hover:bg-emerald-600 text-black font-semibold text-sm px-4 h-9 shadow-sm shadow-emerald-500/20">
                    Get Started
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-20 pb-24 md:pt-32 md:pb-36 overflow-hidden">
        {/* Background glow effects */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[350px] bg-emerald-500/10 blur-[130px] pointer-events-none rounded-full" />
        <div className="absolute top-1/3 left-1/4 w-[300px] h-[300px] bg-teal-500/5 blur-[100px] pointer-events-none rounded-full" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            {/* Hero Left Text */}
            <div className="lg:col-span-7 space-y-6">
              <h1 className="text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white leading-[1.08]">
                Build in a weekend
                <br />
                <span className="text-emerald-500 inline-block">
                  Scale to millions
                </span>
              </h1>

              <p className="text-lg sm:text-xl text-[#a1a1a1] max-w-xl font-normal leading-relaxed">
                Start your project with a Postgres database. Add Authentication, Data APIs, Edge Functions, Realtime Data, Storage, and Vector embeddings.
              </p>

              <div className="pt-2 flex flex-wrap items-center gap-4">
                <Link href="/register">
                  <Button size="lg" className="bg-emerald-500 hover:bg-emerald-600 text-black font-bold px-6 h-12 text-base shadow-lg shadow-emerald-500/20 flex items-center gap-2">
                    Start your project
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>

                <Link href="/projects">
                  <Button size="lg" variant="outline" className="border-white/15 bg-white/5 hover:bg-white/10 text-white font-medium h-12 px-6 text-base">
                    Explore Dashboard
                  </Button>
                </Link>
              </div>

              {/* Supported framework tags */}
              <div className="pt-6 flex items-center gap-6 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-emerald-400" /> PostgreSQL 16
                </span>
                <span className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-emerald-400" /> Row Level Security
                </span>
                <span className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-emerald-400" /> 100% Open Source
                </span>
              </div>
            </div>

            {/* Hero Right: Live Interactive Terminal Card */}
            <div className="lg:col-span-5">
              <div className="rounded-xl border border-white/10 bg-[#1e1e1e] shadow-2xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-[#181818] border-b border-white/5">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-red-500/70" />
                    <div className="h-3 w-3 rounded-full bg-yellow-500/70" />
                    <div className="h-3 w-3 rounded-full bg-green-500/70" />
                    <span className="ml-2 text-xs text-[#808080] font-mono">skynode-cli — quickstart</span>
                  </div>
                  <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                    connected
                  </span>
                </div>

                <div className="p-5 font-mono text-xs space-y-3 leading-relaxed">
                  <div className="text-muted-foreground"># Initialize a new SkyNode Cloud project</div>
                  <div className="text-white flex items-center gap-2">
                    <span className="text-emerald-400">$</span>
                    <span>npx skynode init my-saas-app</span>
                  </div>
                  <div className="text-emerald-400/90 pl-3 border-l-2 border-emerald-500/40 space-y-1 py-1">
                    <div>✓ Provisioning dedicated Postgres schema...</div>
                    <div>✓ Generating REST API Gateway endpoints...</div>
                    <div>✓ Subscribing Realtime WebSocket channels...</div>
                    <div>✓ Configuring S3 storage bucket &amp; RLS...</div>
                  </div>
                  <div className="text-white pt-2">
                    <span className="text-[#888]">Project ready at:</span>{' '}
                    <span className="text-emerald-300 underline underline-offset-2">http://localhost:3000/projects</span>
                  </div>
                </div>

                <div className="px-5 py-3 bg-[#161616] border-t border-white/5 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Database Status:</span>
                  <span className="text-emerald-400 font-medium flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    Active &amp; Ready
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid Section (Matching Supabase's Core 6 Products) */}
      <section id="features" className="py-20 border-t border-white/10 bg-[#161616]/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
              The Complete Backend Suite
            </h2>
            <p className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              Everything you need to ship full-stack apps
            </p>
            <p className="text-muted-foreground text-base">
              A comprehensive platform built with enterprise-grade open source tools. Zero vendor lock-in.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* 1. Postgres Database */}
            <div className="rounded-xl border border-white/10 bg-[#1a1a1a] p-6 hover:border-emerald-500/50 transition-all hover:shadow-lg hover:shadow-emerald-500/5 group flex flex-col justify-between">
              <div>
                <div className="h-10 w-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mb-5 group-hover:scale-105 transition-transform">
                  <Database className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                  Postgres Database
                  <ChevronRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity text-emerald-400" />
                </h3>
                <p className="text-sm text-[#999] leading-relaxed">
                  Every project is a full Postgres database, the world's most trusted relational database. Dedicated schema, visual table editor, and instant migrations.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-white/5 text-xs text-emerald-400 font-medium">
                SQL Editor • Visual Studio • Indexes
              </div>
            </div>

            {/* 2. Authentication */}
            <div className="rounded-xl border border-white/10 bg-[#1a1a1a] p-6 hover:border-emerald-500/50 transition-all hover:shadow-lg hover:shadow-emerald-500/5 group flex flex-col justify-between">
              <div>
                <div className="h-10 w-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mb-5 group-hover:scale-105 transition-transform">
                  <Lock className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                  Authentication
                  <ChevronRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity text-emerald-400" />
                </h3>
                <p className="text-sm text-[#999] leading-relaxed">
                  Add user sign ups and logins, securing your data with Row Level Security. Email/password, OAuth with GitHub, and secure cookie sessions.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-white/5 text-xs text-emerald-400 font-medium">
                GitHub OAuth • Row Level Security • RBAC
              </div>
            </div>

            {/* 3. Edge Functions */}
            <div className="rounded-xl border border-white/10 bg-[#1a1a1a] p-6 hover:border-emerald-500/50 transition-all hover:shadow-lg hover:shadow-emerald-500/5 group flex flex-col justify-between">
              <div>
                <div className="h-10 w-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mb-5 group-hover:scale-105 transition-transform">
                  <Cpu className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                  Edge Functions
                  <ChevronRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity text-emerald-400" />
                </h3>
                <p className="text-sm text-[#999] leading-relaxed">
                  Easily write custom code without deploying or scaling servers. Serverless compute on demand, with built-in Monaco editor and zero cold starts.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-white/5 text-xs text-emerald-400 font-medium">
                Serverless • Isolated Sandbox • Sub-millisecond
              </div>
            </div>

            {/* 4. Storage */}
            <div className="rounded-xl border border-white/10 bg-[#1a1a1a] p-6 hover:border-emerald-500/50 transition-all hover:shadow-lg hover:shadow-emerald-500/5 group flex flex-col justify-between">
              <div>
                <div className="h-10 w-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mb-5 group-hover:scale-105 transition-transform">
                  <HardDrive className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                  Storage
                  <ChevronRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity text-emerald-400" />
                </h3>
                <p className="text-sm text-[#999] leading-relaxed">
                  Store, organize, and serve large files. S3-compatible object storage powered by MinIO with instant image previews, fine-grained access, and public URLs.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-white/5 text-xs text-emerald-400 font-medium">
                S3 Compatible • Image Previews • Public Buckets
              </div>
            </div>

            {/* 5. Realtime */}
            <div className="rounded-xl border border-white/10 bg-[#1a1a1a] p-6 hover:border-emerald-500/50 transition-all hover:shadow-lg hover:shadow-emerald-500/5 group flex flex-col justify-between">
              <div>
                <div className="h-10 w-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mb-5 group-hover:scale-105 transition-transform">
                  <Radio className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                  Realtime
                  <ChevronRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity text-emerald-400" />
                </h3>
                <p className="text-sm text-[#999] leading-relaxed">
                  Listen to PostgreSQL changes in real-time over WebSockets. Broadcast messages, track presence channels, and update UIs automatically on database mutations.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-white/5 text-xs text-emerald-400 font-medium">
                WebSockets • CDC Streams • Presence Tracking
              </div>
            </div>

            {/* 6. Vector Embeddings */}
            <div className="rounded-xl border border-white/10 bg-[#1a1a1a] p-6 hover:border-emerald-500/50 transition-all hover:shadow-lg hover:shadow-emerald-500/5 group flex flex-col justify-between">
              <div>
                <div className="h-10 w-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mb-5 group-hover:scale-105 transition-transform">
                  <Sparkles className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                  Vector Embeddings
                  <ChevronRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity text-emerald-400" />
                </h3>
                <p className="text-sm text-[#999] leading-relaxed">
                  Built-in pgvector extension for AI applications, semantic search, document retrieval, and similarity queries right alongside your relational data.
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-white/5 text-xs text-emerald-400 font-medium">
                pgvector • Semantic Search • RAG Pipelines
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Code Showcase Section */}
      <section id="code-showcase" className="py-20 border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-12 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
              Developer Experience First
            </h2>
            <p className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              Integrate in minutes, with any stack
            </p>
            <p className="text-muted-foreground text-sm">
              Use standard PostgreSQL drivers, auto-generated REST endpoints, or the JavaScript SDK.
            </p>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#161616] overflow-hidden shadow-2xl">
            {/* Code Tabs */}
            <div className="flex flex-wrap items-center justify-between border-b border-white/10 bg-[#121212] px-4 py-2 gap-2">
              <div className="flex items-center gap-1">
                {(Object.keys(CODE_EXAMPLES) as Array<keyof typeof CODE_EXAMPLES>).map((key) => {
                  const active = activeCodeTab === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setActiveCodeTab(key)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                        active
                          ? 'bg-white/10 text-white font-semibold'
                          : 'text-muted-foreground hover:text-white hover:bg-white/5'
                      }`}
                    >
                      {CODE_EXAMPLES[key].title}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy snippet</span>
                  </>
                )}
              </button>
            </div>

            {/* Code Body */}
            <div className="p-6 font-mono text-xs sm:text-sm text-white/90 overflow-x-auto bg-[#141414] leading-relaxed">
              <pre>
                <code>{CODE_EXAMPLES[activeCodeTab].code}</code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* Stats & Infrastructure Section */}
      <section className="py-16 border-t border-white/10 bg-[#151515]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <div className="text-3xl sm:text-4xl font-extrabold text-white">100%</div>
              <div className="text-xs sm:text-sm text-[#888] mt-1">Postgres Compatible</div>
            </div>
            <div>
              <div className="text-3xl sm:text-4xl font-extrabold text-emerald-400">&lt; 10ms</div>
              <div className="text-xs sm:text-sm text-[#888] mt-1">Redis Cached Response</div>
            </div>
            <div>
              <div className="text-3xl sm:text-4xl font-extrabold text-white">Zero</div>
              <div className="text-xs sm:text-sm text-[#888] mt-1">Vendor Lock-in</div>
            </div>
            <div>
              <div className="text-3xl sm:text-4xl font-extrabold text-white">AES-256</div>
              <div className="text-xs sm:text-sm text-[#888] mt-1">Encrypted Credentials</div>
            </div>
          </div>
        </div>
      </section>

      {/* Call to Action Banner */}
      <section className="py-24 border-t border-white/10 relative overflow-hidden bg-gradient-to-b from-[#161616] to-[#0f0f0f]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6 relative z-10">
          <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight">
            Build your next big idea on SkyNode Cloud
          </h2>
          <p className="text-base sm:text-lg text-[#999] max-w-xl mx-auto">
            Get started in seconds. No credit card required. Free tier includes dedicated database and storage.
          </p>
          <div className="pt-2 flex flex-wrap justify-center gap-4">
            <Link href="/register">
              <Button size="lg" className="bg-emerald-500 hover:bg-emerald-600 text-black font-bold px-8 h-12 text-base shadow-lg shadow-emerald-500/25">
                Start your project
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline" className="border-white/15 bg-white/5 hover:bg-white/10 text-white font-medium h-12 px-8 text-base">
                Sign in to Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 bg-[#0d0d0d] py-12 text-xs text-[#777]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 mb-12">
            <div>
              <h4 className="font-semibold text-white mb-3 text-sm">Product</h4>
              <ul className="space-y-2">
                <li><Link href="#features" className="hover:text-white transition-colors">Database</Link></li>
                <li><Link href="#features" className="hover:text-white transition-colors">Authentication</Link></li>
                <li><Link href="#features" className="hover:text-white transition-colors">Storage</Link></li>
                <li><Link href="#features" className="hover:text-white transition-colors">Realtime</Link></li>
                <li><Link href="#features" className="hover:text-white transition-colors">Edge Functions</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-3 text-sm">Resources</h4>
              <ul className="space-y-2">
                <li><Link href="#docs" className="hover:text-white transition-colors">Documentation</Link></li>
                <li><Link href="#pricing" className="hover:text-white transition-colors">Pricing</Link></li>
                <li><Link href="#code-showcase" className="hover:text-white transition-colors">API Reference</Link></li>
                <li><Link href="/projects" className="hover:text-white transition-colors">System Status</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-3 text-sm">Developers</h4>
              <ul className="space-y-2">
                <li><a href="https://github.com" target="_blank" rel="noreferrer" className="hover:text-white transition-colors">GitHub Repository</a></li>
                <li><Link href="/projects" className="hover:text-white transition-colors">Dashboard</Link></li>
                <li><Link href="/login" className="hover:text-white transition-colors">Sign in</Link></li>
                <li><Link href="/register" className="hover:text-white transition-colors">Create account</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-3 text-sm">SkyNode</h4>
              <p className="leading-relaxed mb-4">
                Open source backend-as-a-service built with PostgreSQL, Redis, and MinIO.
              </p>
              <div className="flex items-center gap-2 text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span>All systems operational</span>
              </div>
            </div>
          </div>

          <div className="border-t border-white/5 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <SkyNodeLogo className="h-5 w-5" />
              <span className="font-bold text-white">SkyNode Cloud</span>
              <span>© {new Date().getFullYear()} SkyNode Inc. All rights reserved.</span>
            </div>
            <div className="flex items-center gap-6">
              <Link href="#" className="hover:text-white transition-colors">Privacy Policy</Link>
              <Link href="#" className="hover:text-white transition-colors">Terms of Service</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
