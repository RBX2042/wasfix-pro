import { NextResponse, type NextRequest } from "next/server";

const isDemoMode = process.env.DEMO_MODE === "true" || !process.env.CLERK_SECRET_KEY;

const protectedPaths = ["/dashboard", "/monteur", "/admin"];

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // In demo mode, skip auth — everyone is "logged in" as demo user
  if (isDemoMode) {
    return NextResponse.next();
  }

  // Check protected routes
  const isProtected = protectedPaths.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  // Use Clerk auth dynamically
  try {
    const { clerkMiddleware, createRouteMatcher } = await import("@clerk/nextjs/server");
    const matcher = createRouteMatcher(["/dashboard(.*)", "/monteur(.*)", "/admin(.*)"]);
    return (clerkMiddleware as any)(async (auth: any, request: any) => {
      if (matcher(request)) await auth.protect();
    })(req);
  } catch {
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)",
  ],
};
