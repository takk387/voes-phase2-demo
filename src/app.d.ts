// See https://kit.svelte.dev/docs/types#app

import type { Persona } from '$lib/personas';

declare global {
  namespace App {
    interface Locals {
      persona: Persona;
    }
    interface PageData {
      persona: Persona;
    }
  }
}

export {};
