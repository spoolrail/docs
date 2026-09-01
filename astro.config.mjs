import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightThemeBlack from "starlight-theme-black";

import spoolrailMark from "./src/assets/spoolrail-mark.png";

export default defineConfig({
  site: "https://spoolrail.com",
  integrations: [
    starlight({
      title: "Spoolrail",
      description:
        "Broker-backed messaging for Laravel, with Laravel Queue handling message execution.",
      head: [
        {
          tag: "meta",
          attrs: {
            property: "og:image",
            content: "https://spoolrail.com/social-card-5f1fd172.png",
          },
        },
        {
          tag: "meta",
          attrs: {
            property: "og:image:type",
            content: "image/png",
          },
        },
        {
          tag: "meta",
          attrs: {
            property: "og:image:width",
            content: "1730",
          },
        },
        {
          tag: "meta",
          attrs: {
            property: "og:image:height",
            content: "909",
          },
        },
        {
          tag: "meta",
          attrs: {
            property: "og:image:alt",
            content:
              "Spoolrail pixel-art message routing system with the logo and tagline.",
          },
        },
        {
          tag: "meta",
          attrs: {
            name: "twitter:image",
            content: "https://spoolrail.com/social-card-5f1fd172.png",
          },
        },
        {
          tag: "meta",
          attrs: {
            name: "twitter:image:alt",
            content:
              "Spoolrail pixel-art message routing system with the logo and tagline.",
          },
        },
        {
          tag: "script",
          content: `
            if (localStorage.getItem('starlight-theme') === null) {
              localStorage.setItem('starlight-theme', 'dark');
            }
          `,
        },
      ],
      favicon: "/favicon.svg",
      logo: {
        src: spoolrailMark,
        alt: "Spoolrail",
      },
      editLink: {
        baseUrl: "https://github.com/spoolrail/docs/edit/main/",
      },
      social: [
        {
          icon: "github",
          label: "Spoolrail on GitHub",
          href: "https://github.com/spoolrail/spoolrail",
        },
      ],
      customCss: ["./src/styles/spoolrail.css"],
      plugins: [
        starlightThemeBlack({
          navLinks: [
            { label: "Overview", link: "/" },
            { label: "Documentation", link: "/installation/" },
          ],
          docs: {
            showMarkdownActions: false,
          },
        }),
      ],
      sidebar: [
        {
          label: "Start Here",
          items: ["index", "installation"],
        },
        {
          label: "Core",
          items: [
            "messages",
            "outbox",
            "subscriptions",
            "consumers",
            "delivery-guarantees",
          ],
        },
        {
          label: "Drivers",
          items: ["rabbitmq", "snssqs", "pubsub"],
        },
        {
          label: "Advanced",
          items: ["events", "testing", "extending"],
        },
      ],
    }),
  ],
});
