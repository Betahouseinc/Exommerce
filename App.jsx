import { useState, useEffect, useRef } from "react";
import { motion, useInView, AnimatePresence } from "framer-motion";

// ─── Animation Variants ───────────────────────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 32 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.65, ease: [0.22, 1, 0.36, 1] } },
};
const stagger = {
  visible: { transition: { staggerChildren: 0.12 } },
};

function AnimatedSection({ children, className = "" }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div ref={ref} variants={stagger} initial="hidden" animate={inView ? "visible" : "hidden"} className={className}>
      {children}
    </motion.div>
  );
}

// ─── Theme Colors ─────────────────────────────────────────────────────────────
// Primary: Deep dark #0A0F0A | Accent: Green #22C55E / #4ADE80

function PrimaryButton({ children, size = "md", className = "", secondary = false }) {
  const base = "relative inline-flex items-center justify-center font-semibold rounded-xl transition-all duration-200 overflow-hidden group cursor-pointer";
  const sizes = { sm: "px-4 py-2 text-sm", md: "px-6 py-3 text-sm", lg: "px-8 py-4 text-base" };
  if (secondary) {
    return (
      <button className={`${base} ${sizes[size]} border border-white/20 text-white/80 hover:text-white hover:border-white/40 hover:bg-white/[0.05] ${className}`}>
        {children}
      </button>
    );
  }
  return (
    <button className={`${base} ${sizes[size]} text-white ${className}`} style={{ background: "linear-gradient(135deg,#22C55E,#4ADE80)" }}>
      <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" style={{ background: "linear-gradient(135deg,#4ADE80,#86EFAC)" }} />
      <span className="relative z-10 flex items-center gap-2">{children}</span>
    </button>
  );
}

// ─── Logo ─────────────────────────────────────────────────────────────────────
function Logo({ size = "md" }) {
  const iconSize = size === "sm" ? "w-7 h-7" : "w-8 h-8";
  const textSize = size === "sm" ? "text-base" : "text-xl";
  return (
    <a href="#" className="flex items-center gap-2">
      <div className={`${iconSize} rounded-lg flex items-center justify-center`} style={{ background: "linear-gradient(135deg,#22C55E,#4ADE80)" }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
      </div>
      <span className={`${textSize} font-bold tracking-tight`}>
        <span className="text-white">Exo</span>
        <span className="text-white">mmerce</span>
      </span>
    </a>
  );
}

// ─── Navbar ───────────────────────────────────────────────────────────────────
function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);

  return (
    <motion.nav initial={{ y: -60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "bg-[#0B0F1A]/90 backdrop-blur-xl border-b border-white/[0.06] shadow-[0_2px_24px_rgba(0,0,0,0.5)]" : "bg-transparent"}`}>
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <Logo />
        <div className="hidden md:flex items-center gap-8">
          {["Services", "Why Us", "Process", "Contact"].map((link) => (
            <a key={link} href={`#${link.toLowerCase().replace(" ", "")}`} className="text-sm text-white/55 hover:text-white transition-colors duration-200 font-medium">{link}</a>
          ))}
        </div>
        <div className="hidden md:block">
          <PrimaryButton size="sm">Start a Project</PrimaryButton>
        </div>
        <button className="md:hidden text-white/70 hover:text-white" onClick={() => setMenuOpen(!menuOpen)}>
          <div className="flex flex-col gap-1.5 w-5">
            <span className={`h-[2px] bg-current rounded transition-all duration-200 ${menuOpen ? "rotate-45 translate-y-[7px]" : ""}`} />
            <span className={`h-[2px] bg-current rounded transition-all duration-200 ${menuOpen ? "opacity-0" : ""}`} />
            <span className={`h-[2px] bg-current rounded transition-all duration-200 ${menuOpen ? "-rotate-45 -translate-y-[7px]" : ""}`} />
          </div>
        </button>
      </div>
      <AnimatePresence>
        {menuOpen && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-[#0B0F1A]/95 backdrop-blur-xl border-t border-white/[0.06] overflow-hidden">
            <div className="px-6 py-4 flex flex-col gap-4">
              {["Services", "Why Us", "Process", "Contact"].map((link) => (
                <a key={link} href={`#${link.toLowerCase().replace(" ", "")}`} className="text-white/70 hover:text-white text-sm font-medium" onClick={() => setMenuOpen(false)}>{link}</a>
              ))}
              <PrimaryButton size="sm" className="w-fit">Start a Project</PrimaryButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────
function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
      {/* Background glows */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] rounded-full opacity-20 blur-[120px]" style={{ background: "radial-gradient(circle,#22C55E,transparent 70%)" }} />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] rounded-full opacity-15 blur-[100px]" style={{ background: "radial-gradient(circle,#4ADE80,transparent 70%)" }} />
      </div>
      {/* Grid overlay */}
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.5) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.5) 1px,transparent 1px)", backgroundSize: "48px 48px" }} />

      <div className="relative max-w-4xl mx-auto px-6 py-24 text-center">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#22C55E]/30 bg-[#22C55E]/10 text-[#22C55E] text-xs font-medium mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E] animate-pulse" />
          Exommerce LLP · Bengaluru · Est. 2019
        </motion.div>

        <motion.h1 initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.1 }}
          className="text-5xl md:text-6xl lg:text-7xl font-black tracking-tight leading-[1.05] text-white mb-6">
          Your Trusted<br />
          <span className="bg-clip-text text-transparent" style={{ backgroundImage: "linear-gradient(135deg,#22C55E,#4ADE80)" }}>IT Consulting</span><br />
          Partner.
        </motion.h1>

        <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.25 }}
          className="text-white/50 text-lg leading-relaxed max-w-2xl mx-auto mb-10">
          Exommerce LLP is a Bengaluru-based IT consulting firm helping businesses modernize infrastructure, integrate data systems, and build technology solutions that drive real outcomes.
        </motion.p>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.4 }}
          className="flex flex-col sm:flex-row gap-3 justify-center">
          <PrimaryButton size="lg" className="shadow-[0_0_40px_rgba(34,197,94,0.25)]">
            Start a Project
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
          </PrimaryButton>
          <PrimaryButton size="lg" secondary>View Our Services</PrimaryButton>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.55 }}
          className="flex gap-12 justify-center mt-14 pt-10 border-t border-white/[0.07]">
          {[["5+", "Years in Business"], ["200+", "Projects Delivered"], ["98%", "Client Satisfaction"]].map(([val, label]) => (
            <div key={label} className="text-center">
              <div className="text-2xl font-black text-white">{val}</div>
              <div className="text-xs text-white/35 mt-1 font-medium">{label}</div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ─── Services ─────────────────────────────────────────────────────────────────
const services = [
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
      </svg>
    ),
    title: "Cloud Services Consultation",
    desc: "Strategic cloud adoption, multi-cloud architecture design, cost optimization, and migration planning across AWS, Azure, and GCP. We help you pick the right platform and deploy it right.",
    tags: ["AWS", "Azure", "GCP", "Migration"],
    accent: "#22C55E",
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
      </svg>
    ),
    title: "IT Operations Management",
    desc: "End-to-end management of your IT infrastructure — from server administration and network monitoring to incident response and capacity planning. Keep your systems healthy around the clock.",
    tags: ["NOC", "ITSM", "Monitoring", "SLA"],
    accent: "#4ADE80",
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
      </svg>
    ),
    title: "Data Integration",
    desc: "Connect disparate systems, databases, and SaaS platforms into a unified data layer. We design ETL/ELT pipelines, API integrations, and real-time data sync solutions that eliminate silos.",
    tags: ["ETL", "APIs", "Kafka", "Pipelines"],
    accent: "#22C55E",
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
      </svg>
    ),
    title: "Custom Projects & Development",
    desc: "From internal tooling and workflow automation to customer-facing portals and enterprise applications — we design, build, and maintain bespoke software tailored to your exact requirements.",
    tags: ["Web Apps", "Automation", "Portals", "APIs"],
    accent: "#4ADE80",
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
    title: "Cybersecurity & Compliance",
    desc: "Security assessments, vulnerability management, endpoint protection, and compliance readiness (ISO 27001, SOC 2, GDPR). We harden your systems and keep you audit-ready.",
    tags: ["ISO 27001", "SOC 2", "Pen Testing", "SIEM"],
    accent: "#22C55E",
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
      </svg>
    ),
    title: "Data Analytics & Business Intelligence",
    desc: "Transform raw data into decisions. We build data warehouses, dashboards, and BI platforms that give your leadership real-time visibility into KPIs and operational metrics.",
    tags: ["Power BI", "Tableau", "Snowflake", "SQL"],
    accent: "#4ADE80",
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
    ),
    title: "IT Infrastructure & Networking",
    desc: "Design, deployment, and management of on-prem and hybrid infrastructure — servers, storage, LAN/WAN, SD-WAN, and VPN. Built for reliability, scalability, and performance.",
    tags: ["SD-WAN", "VMware", "Cisco", "HCI"],
    accent: "#22C55E",
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    title: "IT Strategy & Digital Transformation",
    desc: "CIO-level advisory to align your technology roadmap with business goals. From technology audits and vendor selection to change management and digital transformation programs.",
    tags: ["Roadmapping", "Vendor Mgmt", "CIO Advisory"],
    accent: "#4ADE80",
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
    title: "Managed IT Support",
    desc: "24/7 helpdesk, remote and on-site support, asset lifecycle management, and proactive system maintenance — so your teams stay productive and issues get resolved fast.",
    tags: ["24/7 Helpdesk", "Remote Support", "Asset Mgmt"],
    accent: "#22C55E",
  },
];

function Services() {
  return (
    <section id="services" className="py-28 relative">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full opacity-8 blur-[120px]" style={{ background: "radial-gradient(ellipse,#22C55E,transparent)" }} />
      </div>
      <div className="max-w-5xl mx-auto px-6 relative">
        <AnimatedSection className="text-center mb-16">
          <motion.p variants={fadeUp} className="text-[#22C55E] text-sm font-semibold uppercase tracking-[0.2em] mb-3">What We Do</motion.p>
          <motion.h2 variants={fadeUp} className="text-4xl md:text-5xl font-black text-white tracking-tight">Consulting Services</motion.h2>
          <motion.p variants={fadeUp} className="text-white/40 mt-4 max-w-xl mx-auto">End-to-end IT consulting — strategy, implementation, and ongoing support across every layer of your technology stack.</motion.p>
        </AnimatedSection>

        <AnimatedSection className="grid md:grid-cols-2 gap-3">
          {services.map((s, i) => (
            <motion.div key={s.title} variants={fadeUp} whileHover={{ x: 4 }} transition={{ type: "spring", stiffness: 400, damping: 25 }}
              className="group flex items-center gap-4 px-5 py-4 rounded-xl border border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.12] transition-all duration-200 cursor-default">
              {/* Number */}
              <span className="text-xs font-bold tabular-nums shrink-0 w-5 text-right" style={{ color: "#22C55E" }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              {/* Icon */}
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-110"
                style={{ background: `${s.accent}15`, color: s.accent }}>
                {s.icon}
              </div>
              {/* Title + tags */}
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold text-sm leading-tight">{s.title}</p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {s.tags.map((tag) => (
                    <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full border border-white/[0.08] text-white/30 font-medium">{tag}</span>
                  ))}
                </div>
              </div>
              {/* Arrow */}
              <svg className="w-4 h-4 text-white/20 group-hover:text-[#22C55E] transition-colors duration-200 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </motion.div>
          ))}
        </AnimatedSection>
      </div>
    </section>
  );
}

// ─── Why Us ───────────────────────────────────────────────────────────────────
const pillars = [
  { num: "01", label: "Commerce DNA", desc: "Born as a drop-shipping business in 2019, we understand commercial operations from the inside — not just the tech side.", icon: "🛒" },
  { num: "02", label: "Bengaluru-Based", desc: "Headquartered in India's Silicon Valley. We combine global IT standards with local context and competitive pricing.", icon: "📍" },
  { num: "03", label: "Vendor-Agnostic", desc: "We recommend the best tools for your needs — not the ones we're commissioned to sell. Your outcomes drive every decision.", icon: "⚖️" },
  { num: "04", label: "Long-Term Partnership", desc: "From e-commerce roots to IT consulting — we grow with our clients. We measure success by your outcomes, not ticket counts.", icon: "🤝" },
];

function WhyUs() {
  return (
    <section id="whyus" className="py-28 relative">
      <div className="max-w-7xl mx-auto px-6">
        <AnimatedSection className="text-center mb-16">
          <motion.p variants={fadeUp} className="text-[#22C55E] text-sm font-semibold uppercase tracking-[0.2em] mb-3">Why Exommerce</motion.p>
          <motion.h2 variants={fadeUp} className="text-4xl md:text-5xl font-black text-white tracking-tight">Built Different</motion.h2>
          <motion.p variants={fadeUp} className="text-white/40 mt-4 max-w-md mx-auto">6 years of hustle — from running drop-shipping operations to delivering enterprise IT. That commercial grit sets us apart.</motion.p>
        </AnimatedSection>
        <AnimatedSection className="grid md:grid-cols-4 gap-5">
          {pillars.map((p) => (
            <motion.div key={p.num} variants={fadeUp} whileHover={{ scale: 1.03, y: -4 }}
              className="group relative text-center px-6 py-8 rounded-2xl border border-white/[0.07] bg-white/[0.03] backdrop-blur-md overflow-hidden">
              <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-400"
                style={{ boxShadow: "inset 0 0 30px rgba(34,197,94,0.07)" }} />
              <div className="text-3xl mb-4">{p.icon}</div>
              <div className="text-[#4ADE80] text-xs font-bold tracking-[0.2em] mb-2">{p.num}</div>
              <h3 className="text-white font-bold text-lg mb-3">{p.label}</h3>
              <p className="text-white/40 text-sm leading-relaxed">{p.desc}</p>
            </motion.div>
          ))}
        </AnimatedSection>
      </div>
    </section>
  );
}

// ─── Process ──────────────────────────────────────────────────────────────────
function Process() {
  const steps = [
    { num: "01", label: "Discovery & Audit", desc: "We assess your current IT environment, understand your goals, and identify gaps and opportunities.", icon: "◎" },
    { num: "02", label: "Strategy & Roadmap", desc: "We deliver a clear technology roadmap with prioritized initiatives, timelines, and resource requirements.", icon: "⬡" },
    { num: "03", label: "Implementation", desc: "Our engineers execute the plan — on schedule, on budget, with weekly progress updates.", icon: "✦" },
    { num: "04", label: "Support & Optimization", desc: "We stay on post-launch to monitor, optimize, and iterate — so your investment keeps compounding.", icon: "🚀" },
  ];
  return (
    <section id="process" className="py-28 relative">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute bottom-0 right-0 w-[500px] h-[400px] rounded-full opacity-8 blur-[120px]" style={{ background: "radial-gradient(ellipse,#22C55E,transparent)" }} />
      </div>
      <div className="max-w-7xl mx-auto px-6 relative">
        <AnimatedSection className="text-center mb-16">
          <motion.p variants={fadeUp} className="text-[#4ADE80] text-sm font-semibold uppercase tracking-[0.2em] mb-3">How We Work</motion.p>
          <motion.h2 variants={fadeUp} className="text-4xl md:text-5xl font-black text-white tracking-tight">Our Engagement Model</motion.h2>
          <motion.p variants={fadeUp} className="text-white/40 mt-4 max-w-md mx-auto">A structured, transparent approach that keeps you informed and in control at every stage.</motion.p>
        </AnimatedSection>
        <AnimatedSection className="grid md:grid-cols-4 gap-5">
          {steps.map((step) => (
            <motion.div key={step.num} variants={fadeUp} whileHover={{ scale: 1.03, y: -4 }}
              className="group relative text-center px-6 py-8 rounded-2xl border border-white/[0.07] bg-white/[0.03] backdrop-blur-md overflow-hidden">
              <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-400"
                style={{ boxShadow: "inset 0 0 30px rgba(34,197,94,0.06)" }} />
              <div className="text-3xl mb-4">{step.icon}</div>
              <div className="text-[#22C55E] text-xs font-bold tracking-[0.2em] mb-2">{step.num}</div>
              <h3 className="text-white font-bold text-lg mb-3">{step.label}</h3>
              <p className="text-white/40 text-sm leading-relaxed">{step.desc}</p>
            </motion.div>
          ))}
        </AnimatedSection>
      </div>
    </section>
  );
}

// ─── CTA ──────────────────────────────────────────────────────────────────────
function CTA() {
  return (
    <section id="contact" className="py-28 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[400px] rounded-full opacity-20 blur-[120px]"
          style={{ background: "radial-gradient(ellipse,#22C55E 0%,#4ADE80 50%,transparent 80%)" }} />
      </div>
      <div className="absolute inset-0 opacity-[0.025]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.6) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.6) 1px,transparent 1px)", backgroundSize: "48px 48px" }} />
      <div className="relative max-w-4xl mx-auto px-6 text-center">
        <AnimatedSection>
          <motion.div variants={fadeUp} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#22C55E]/30 bg-[#22C55E]/10 text-[#4ADE80] text-xs font-medium mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-[#4ADE80] animate-pulse" />
            Currently accepting new clients · Bengaluru & Remote
          </motion.div>
          <motion.h2 variants={fadeUp} className="text-4xl md:text-6xl font-black text-white tracking-tight leading-tight mb-6">
            Have a Project<br />
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: "linear-gradient(135deg,#22C55E,#4ADE80)" }}>In Mind?</span>
          </motion.h2>
          <motion.p variants={fadeUp} className="text-white/40 text-lg max-w-lg mx-auto mb-10">
            Let's build something great together. Book a free 30-minute discovery call and we'll outline a clear path forward — no strings attached.
          </motion.p>
          <motion.div variants={fadeUp} className="flex flex-col sm:flex-row gap-3 justify-center">
            <PrimaryButton size="lg" className="shadow-[0_0_40px_rgba(34,197,94,0.25)]">
              Start a Project
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
            </PrimaryButton>
            <PrimaryButton size="lg" secondary>hello@exommerce.in</PrimaryButton>
          </motion.div>
        </AnimatedSection>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="border-t border-white/[0.06] py-10">
      <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Logo size="sm" />
          <span className="text-white/25 text-xs pl-9">Exommerce LLP · Bengaluru, Karnataka</span>
        </div>
        <p className="text-white/25 text-sm">© {new Date().getFullYear()} Exommerce LLP. Est. 2019. All rights reserved.</p>
        <div className="flex gap-5">
          {["Privacy", "Terms", "hello@exommerce.in"].map((l) => (
            <a key={l} href="#" className="text-sm text-white/30 hover:text-white/60 transition-colors">{l}</a>
          ))}
        </div>
      </div>
    </footer>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <div className="min-h-screen font-sans antialiased" style={{ background: "#0A0F0A" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap');
        * { font-family: 'Plus+Jakarta+Sans', sans-serif; }
        html { scroll-behavior: smooth; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #0A0F0A; }
        ::-webkit-scrollbar-thumb { background: #142014; border-radius: 3px; }
      `}</style>
      <Navbar />
      <Hero />
      <Services />
      <WhyUs />
      <Process />
      <CTA />
      <Footer />
    </div>
  );
}
