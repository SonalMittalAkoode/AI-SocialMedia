"use client";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Sparkles,
  ScanLine,
  Users,
  WandSparkles,
  Layers,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  Menu,
} from "lucide-react";
import { Logo, Button, Badge } from "@/components/ui";
import { Creative } from "@/components/content/post-card";
import { useStore } from "@/store/provider";
import { useRouter } from "next/navigation";
import { useState } from "react";
const features = [
  {
    icon: ScanLine,
    title: "A brand brain, built for you.",
    description:
      "Turn your website into a brand profile. Your personality, your audience, your unique perspective.",
  },
  {
    icon: Users,
    title: "Find your competitive edge.",
    description:
      "Explore market themes and discover content opportunities worth making your own.",
  },
  {
    icon: WandSparkles,
    title: "From blank page to on-brand.",
    description:
      "Create thoughtful posts, captions, and fresh ideas in a single creative workspace.",
  },
  {
    icon: Layers,
    title: "One workspace. Every channel.",
    description: "Shape your message for Instagram, Facebook, LinkedIn, and X.",
  },
  {
    icon: CalendarDays,
    title: "Your content, in rhythm.",
    description:
      "Plan ahead with a visual calendar that keeps your next great post in sight.",
  },
  {
    icon: ChartNoAxesCombined,
    title: "Make your next move smarter.",
    description:
      "Explore an illustrative view of your content, platform mix, and creative momentum.",
  },
];
export function Landing() {
  const { setState } = useStore();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  function demo() {
    setState((s) => ({
      ...s,
      user: s.user || { name: "Alex Morgan", email: "alex@example.com" },
      authenticated: true,
      onboarding: { step: 4, completed: true },
    }));
    router.push("/dashboard");
  }
  return (
    <div className="marketing">
      <nav className="marketing-nav">
        <Logo />
        <div className={`marketing-links ${menu ? "mobile-open" : ""}`}>
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
          <a href="#pricing">Pricing</a>
        </div>
        <div className="nav-actions">
          <Link href="/login">
            Log in <ArrowUpRight size={14} />
          </Link>
          <Button asChild>
            <Link href="/signup">
              Get started <ArrowRight size={15} />
            </Link>
          </Button>
          <button
            className="mobile-menu icon-button"
            aria-label="Toggle navigation"
            onClick={() => setMenu(!menu)}
          >
            <Menu />
          </button>
        </div>
      </nav>
      <main>
        <section className="hero">
          <div className="hero-orbit orbit-one" />
          <div className="hero-orbit orbit-two" />
          <Badge tone="green">
            <Sparkles size={12} /> YOUR NEXT CHAPTER STARTS HERE
          </Badge>
          <h1>
            Your brand. Your voice.
            <br />
            <span>Powered by AI.</span>
          </h1>
          <p>
            Turn your business into a content powerhouse.
            <br />
            Discover competitors, generate scroll-stopping posts, and manage
            your social presence with AI.
          </p>
          <div className="hero-actions">
            <Button asChild>
              <Link href="/signup">
                Get started for free <ArrowRight size={17} />
              </Link>
            </Button>
            <Button variant="secondary" onClick={demo}>
              Explore the dashboard <ArrowUpRight size={16} />
            </Button>
          </div>
          <div className="hero-footnote">
            <span className="tiny-avatars">
              <i>J</i>
              <i>M</i>
              <i>A</i>
            </span>
            <span>
              Your ideas. AI’s helping hand.{" "}
              <strong>Endless possibilities.</strong>
            </span>
          </div>
          <div className="product-preview">
            <div className="preview-sidebar">
              <Logo />
              <small>WORKSPACE</small>
              {[
                "Overview",
                "AI Content Studio",
                "My Posts",
                "Competitors",
                "Content Calendar",
              ].map((n, i) => (
                <div key={n} className={i === 0 ? "selected" : ""}>
                  {i === 0 ? <Layers size={14} /> : <Sparkles size={14} />} {n}
                </div>
              ))}
              <div className="preview-upgrade">
                <Sparkles size={18} />
                <strong>A little AI. A lot of possibility.</strong>
                <span>Your creative co-pilot is ready.</span>
              </div>
            </div>
            <div className="preview-content">
              <div className="preview-topbar">
                <span>Workspace overview</span>
                <Badge tone="green">✦ Demo workspace</Badge>
              </div>
              <div className="preview-greeting">
                <div>
                  <h3>
                    A good day to make an impact. <span>✳</span>
                  </h3>
                  <p>Big ideas start with a little inspiration.</p>
                </div>
                <Button onClick={demo}>
                  <Sparkles size={14} /> Create a post
                </Button>
              </div>
              <div className="preview-stats">
                {[
                  ["Generated posts", "48", "+12 this week"],
                  ["Scheduled posts", "12", "Right on schedule"],
                  ["Creative momentum", "+24%", "Looking good"],
                ].map(([l, v, s]) => (
                  <div key={l}>
                    <small>{l}</small>
                    <strong>{v}</strong>
                    <span>{s}</span>
                  </div>
                ))}
              </div>
              <div className="preview-posts">
                <div>
                  <div className="row-between">
                    <h4>Your next great posts</h4>
                    <span>View all ↗</span>
                  </div>
                  <div className="preview-creatives">
                    <Creative variant={0} />
                    <Creative variant={1} />
                    <Creative variant={2} />
                  </div>
                </div>
                <div className="preview-insight">
                  <Badge tone="green">
                    <Sparkles size={11} /> A LITTLE INSPIRATION
                  </Badge>
                  <h4>Your audience loves a story.</h4>
                  <p>
                    Bring them behind the scenes. Your next post could be the
                    start of a conversation.
                  </p>
                  <button className="text-button" onClick={demo}>
                    Let’s make something <ArrowUpRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className="trust-strip">
          <span>MADE FOR BRANDS WITH SOMETHING TO SAY.</span>
          <div>
            Independent businesses <span>✳</span> Creative teams <span>✳</span>{" "}
            Growing agencies <span>✳</span> Big dreamers
          </div>
        </section>
        <section className="marketing-section" id="features">
          <div className="section-intro">
            <div className="eyebrow">LESS BUSYWORK. MORE BRILLIANCE.</div>
            <h2>
              Your entire social world.
              <br />
              <span>One intelligent workspace.</span>
            </h2>
            <p>
              From the first spark to the final post, give your brand the space
              to do its thing.
            </p>
          </div>
          <div className="feature-grid">
            {features.map((f) => (
              <article className="feature-card" key={f.title}>
                <div className="feature-icon">
                  <f.icon size={23} />
                </div>
                <h3>{f.title}</h3>
                <p>{f.description}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="marketing-section how-section" id="how-it-works">
          <div className="section-intro">
            <div className="eyebrow">FROM HELLO TO LET’S GO</div>
            <h2>
              A simpler path to
              <br />
              <span>your next big thing.</span>
            </h2>
          </div>
          <div className="steps-grid">
            {[
              "Connect your brand",
              "Discover your market",
              "Generate content",
              "Grow your presence",
            ].map((s, i) => (
              <div key={s}>
                <span className="step-number">0{i + 1}</span>
                <h3>{s}</h3>
                <p>
                  {
                    [
                      "Share a URL. Give your brand a home.",
                      "Explore ideas beyond your own feed.",
                      "Put your voice into every post.",
                      "Build a rhythm that works for you.",
                    ][i]
                  }
                </p>
              </div>
            ))}
          </div>
        </section>
        <section className="marketing-section" id="pricing">
          <div className="section-intro">
            <Badge>ILLUSTRATIVE DEMO PRICING</Badge>
            <h2>
              A little room to start.
              <br />
              <span>A lot of room to grow.</span>
            </h2>
            <p>
              Explore sample plans. No payments or subscriptions are active.
            </p>
          </div>
          <div className="pricing-grid">
            {[
              [
                "Starter",
                "19",
                "For your first big ideas.",
                "30 sample posts",
                "1 brand workspace",
              ],
              [
                "Growth",
                "49",
                "For brands finding their rhythm.",
                "100 sample posts",
                "Competitor discovery",
              ],
              [
                "Agency",
                "99",
                "For a world of possibilities.",
                "Unlimited sample ideas",
                "Multiple workspaces · future",
              ],
            ].map(([name, price, desc, a, b], i) => (
              <article
                className={`price-card ${i === 1 ? "featured" : ""}`}
                key={name}
              >
                {i === 1 && <Badge tone="green">ROOM TO GROW</Badge>}
                <h3>{name}</h3>
                <p>{desc}</p>
                <div className="price">
                  ${price}
                  <small>/ month</small>
                </div>
                <span className="muted">Placeholder pricing</span>
                <p>
                  <Check size={15} /> {a}
                </p>
                <p>
                  <Check size={15} /> {b}
                </p>
                <Button variant={i === 1 ? "primary" : "secondary"} asChild>
                  <Link href="/signup">
                    Try the free demo <ArrowRight size={15} />
                  </Link>
                </Button>
              </article>
            ))}
          </div>
        </section>
        <section className="final-cta">
          <Sparkles size={35} />
          <h2>
            Your brand has a story.
            <br />
            Let’s help it find its people.
          </h2>
          <Button asChild>
            <Link href="/signup">
              Get started for free <ArrowRight size={17} />
            </Link>
          </Button>
          <p>Frontend demo. No credit card. Just possibilities.</p>
        </section>
      </main>
      <footer className="marketing-footer">
        <Logo />
        <p>A little intelligence. A lot of impact.</p>
        <div>
          <a href="#features">Product</a>
          <a href="#how-it-works">Resources</a>
          <Link href="/legal">Privacy & terms</Link>
        </div>
        <small>© 2026 SocialAI. Demo experience.</small>
      </footer>
    </div>
  );
}
