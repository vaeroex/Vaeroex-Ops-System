import Link from "next/link";
import type { Route } from "next";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { PublicNavigation } from "@/components/marketing/PublicNavigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import "@/components/marketing/public-design.css";

async function isLoggedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return false;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return Boolean(user);
}

export async function PublicSiteHeader() {
  const loggedIn = await isLoggedIn();
  return (
    <header className="vx-header">
      <a href="#public-content" className="vx-skip">
        Skip to content
      </a>
      <div className="vx-header-inner">
        <Link href="/" className="vx-wordmark" aria-label="Vaeroex home">
          <Image src="/icon-192.png" width={31} height={31} alt="" priority />
          <span>VAEROEX</span>
        </Link>
        <PublicNavigation loggedIn={loggedIn} />
        <div className="vx-header-actions">
          <Link href={(loggedIn ? "/systems" : "/login") as Route}>
            {loggedIn ? "Your Systems" : "Log in"}
          </Link>
          <Link href="/contact?inquiry=custom-business-systems" className="vx-button vx-button--primary">
            Discuss a Project
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        </div>
      </div>
      <span id="public-content" tabIndex={-1} />
    </header>
  );
}
