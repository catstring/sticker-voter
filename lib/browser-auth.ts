"use client";

export function isEmbeddedBrowser(): boolean {
  if (typeof navigator === "undefined") return false;

  const ua = navigator.userAgent || "";
  const commonInAppTokens =
    /FBAN|FBAV|FB_IAB|Instagram|Line|MicroMessenger|Twitter|Threads|WebView|wv|Snapchat|TikTok/i;
  if (commonInAppTokens.test(ua)) return true;

  const iOSWebView = /iPhone|iPad|iPod/i.test(ua) && /AppleWebKit/i.test(ua) && !/Safari/i.test(ua);
  return iOSWebView;
}
