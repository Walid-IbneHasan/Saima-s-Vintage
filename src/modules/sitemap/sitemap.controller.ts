import { Controller, Get, Header, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { SitemapService } from './sitemap.service';

@Controller()
export class SitemapController {
  constructor(private readonly sitemap: SitemapService) {}

  @Get('sitemap.xml')
  @SkipThrottle()
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  async xml(@Res({ passthrough: true }) res: Response): Promise<string> {
    return this.sitemap.buildXml();
  }

  @Get('robots.txt')
  @SkipThrottle()
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=86400')
  robots(): string {
    return this.sitemap.robotsTxt();
  }
}
