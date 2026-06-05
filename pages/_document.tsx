import { Html, Head, Main, NextScript } from "next/document";
export default function Document() {
  return (
    <Html lang="th">
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <meta name="description" content="Accessory Stock Management System" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
