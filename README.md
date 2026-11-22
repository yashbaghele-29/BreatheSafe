# BreatheSafe

BreatheSafe — Winter Smog & Clean Air Family Assistant

BreatheSafe is a simple, GenAI-powered web application that helps everyday families and neighborhoods navigate severe winter smog and urban air pollution.
Instead of overwhelming charts or complex scientific jargon, it gives households clear, location-tailored steps they can take today—and explains the direct impact of each choice on both their indoor breathing air and neighborhood sky.

Features

Location & Lifestyle Tailoring
Enter any city or neighborhood (or use browser location) along with smog severity, household profile (kids, seniors/asthma care, apartment, or community group), and daily commute/heating habits.
Generates a personalized daily plan powered by Gemini (gemini-4-hydrogen).
Low-Emission Daily Routine & Family Pledge
Time-of-day guidance (Morning, Afternoon, Evening) timed around winter thermal inversions.
Interactive checklist where checking off habits dynamically updates your estimated indoor PM2.5 exposure reduction and daily community emissions avoided.
Practical Indoor Air Quality Hacks
Budget-friendly steps (Free and Low Cost filters) such as wet mopping vs. dry sweeping, kitchen exhaust habits, window draft sealing, and DIY MERV-13 box-fan purifiers.
Direct Impact Explorer & Community Sharing
Side-by-side comparison of common winter habits versus sustainable swaps, showing both Family Lung Benefit and Neighborhood Air Impact.
Includes a one-click copyable neighbor tip for sharing in local community or apartment groups.
Plain-Language Clean Air Q&A
Ask practical questions about masks, opening windows, cooking fumes, or apartment-wide winter smoke reduction and receive a concise answer, one immediate action, and its direct impact.

Project Structure

index.html — HTML entry point, SEO metadata, and typography (Plus Jakarta Sans, DM Sans, IBM Plex Mono)
src/index.css — Tailwind CSS styles and accessibility/motion rules
src/App.tsx & src/components/ — Modular React + TypeScript/JavaScript UI components:
Header.tsx — Simple single-row navigation
SetupHero.tsx — 4-field family setup form and local winter summary strip
DailyRoutineSection.tsx — Interactive daily checklist with time-of-day filters
IndoorAirSection.tsx — Low-cost indoor air quality hacks
ImpactSection.tsx — Sustainable swap impact explorer & neighbor tip copy tool
AssistantSection.tsx — GenAI Q&A assistant
server.ts — Express server providing /api/plan and /api/ask endpoints via @google/genai

Getting Started

Install dependencies:
Bash
npm install
Configure environment:
Ensure GEMINI_API_KEY is set in your environment or .env file (see .env.example).
Run in development:
Bash
npm run dev
The app runs on http://localhost:3000.
Build for production:
Bash
npm run build
npm start
