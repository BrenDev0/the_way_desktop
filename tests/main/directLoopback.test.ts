import { describe, expect, it } from "vitest";
import { directLoopback, loopbackUrl } from "../../src/main/serverConnectionAdapter";

describe("loopbackUrl", () => {
  it("keeps a presigned URL whole, only its host changed", () => {
    const signed = "http://localhost:9090/the-way/the_way/files/abc?AWSAccessKeyId=k&Signature=s%3D&Expires=1";
    expect(loopbackUrl(signed)).toBe("http://127.0.0.1:9090/the-way/the_way/files/abc?AWSAccessKeyId=k&Signature=s%3D&Expires=1");
  });

  it("never touches a real bucket's URL, whose signature covers its host", () => {
    const signed = "https://the-way.s3.us-east-1.amazonaws.com/key?X-Amz-Signature=abc";
    expect(loopbackUrl(signed)).toBe(signed);
  });
});

describe("directLoopback", () => {
  it("reaches a server on this machine by its address, not by the name localhost", () => {
    expect(directLoopback("http://localhost:8000")).toBe("http://127.0.0.1:8000");
    expect(directLoopback("http://localhost:8000/")).toBe("http://127.0.0.1:8000");
  });

  it("leaves every other address as it is", () => {
    expect(directLoopback("https://api.example.com")).toBe("https://api.example.com");
    expect(directLoopback("http://127.0.0.1:8000")).toBe("http://127.0.0.1:8000");
    expect(directLoopback("not a url")).toBe("not a url");
  });
});
