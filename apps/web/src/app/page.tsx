import { LandingShell } from "@/components/LandingShell";
import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/Hero";
import { SpotlightGallery } from "@/components/spotlight/SpotlightGallery";
import { StatsProof } from "@/components/StatsProof";
import { SupportDemo } from "@/components/SupportDemo";
import { SupportFeatures } from "@/components/features/SupportFeatures";
import { HowItWorks } from "@/components/HowItWorks";
import { FounderNote } from "@/components/FounderNote";
import { Pricing } from "@/components/Pricing";
import { Faq } from "@/components/Faq";
import { Footer, FooterCta } from "@/components/Footer";
import { ChatLauncher } from "@/components/ChatLauncher";

const container = "mx-auto max-w-[var(--landing-content-width)] px-[var(--landing-gutter)]";

export default function Home() {
  return (
    <LandingShell>
      <Navbar />
      <main className="font-normal [font-family:var(--font-suisse)] [&_h1]:lowercase [&_h2]:lowercase [&_h2]:font-normal [&_h2]:tracking-[-.04em] [&_h3]:lowercase [&_h3]:font-normal">
        <Hero />
        <div className={container}>
          <section id="features" aria-label="Features your app is missing" className="scroll-mt-28 pt-[var(--landing-heading-gap)]">
            <div className="pb-[calc(var(--landing-section-gap)/2)]">
              <SpotlightGallery />
            </div>
            <StatsProof />
          </section>
          <SupportDemo />
        </div>
        <div className={container}>
          <SupportFeatures />
          <HowItWorks />
          <FounderNote />
          <Pricing />
          <Faq />
        </div>
        <div className={container}>
          <FooterCta />
          <Footer />
        </div>
      </main>
      <ChatLauncher />
    </LandingShell>
  );
}
