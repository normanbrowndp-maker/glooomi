import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUrl, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SocialService } from './social.service';
class NewPostDto { @IsString() @MinLength(1) mediaId!: string; @IsOptional() @IsString() @MaxLength(2200) caption?: string; @IsOptional() @IsString() location?: string; }
class CommentDto { @IsString() @MinLength(1) @MaxLength(2000) body!: string; }
class StoryDto { @IsString() @MinLength(1) mediaId!: string; @IsOptional() @IsString() @MaxLength(500) caption?: string; }
class MessageDto { @IsString() @MinLength(1) @MaxLength(5000) body!: string; }
class ProfileDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(24) @Matches(/^[a-zA-Z0-9_.]+$/) username?: string;
  @IsOptional() @IsString() @MaxLength(80) displayName?: string;
  @IsOptional() @IsString() @MaxLength(500) bio?: string;
  @IsOptional() @ValidateIf((_object, value) => value !== '') @IsUrl({ require_protocol: true, protocols: ['http','https'] }) @MaxLength(300) website?: string;
  @IsOptional() @IsIn(['PUBLIC','PRIVATE']) visibility?: 'PUBLIC'|'PRIVATE';
}
@UseGuards(JwtAuthGuard)
@Controller()
export class SocialController {
  constructor(private social: SocialService) {}
  @Get('suggestions') suggestions(@Req() r: any) { return this.social.suggestions(r.user.sub); }
  @Get('follow-requests') followRequests(@Req() r: any) { return this.social.followRequests(r.user.sub); }
  @Post('follow-requests/:id/accept') acceptRequest(@Req() r: any, @Param('id') id: string) { return this.social.resolveFollowRequest(r.user.sub, id, true); }
  @Post('follow-requests/:id/reject') rejectRequest(@Req() r: any, @Param('id') id: string) { return this.social.resolveFollowRequest(r.user.sub, id, false); }
  @Get('profiles/:username/followers') followers(@Req() r: any, @Param('username') username: string) { return this.social.connections(username, r.user.sub, 'followers'); }
  @Get('profiles/:username/following') following(@Req() r: any, @Param('username') username: string) { return this.social.connections(username, r.user.sub, 'following'); }
  @Get('posts/:id') post(@Req() r: any, @Param('id') id: string) { return this.social.post(id, r.user.sub); }
  @Delete('posts/:id') deletePost(@Req() r: any, @Param('id') id: string) { return this.social.deletePost(r.user.sub, id); }
  @Get('feed') feed(@Req() r: any, @Query('cursor') c?: string) { return this.social.feed(r.user.sub, c); }
  @Get('explore') explore(@Req() r: any, @Query('q') q?: string, @Query('videos') videos?: string) { return this.social.explore(q, videos === 'true', r.user.sub); }
  @Get('search/users') search(@Req() r: any, @Query('q') q = '') { return this.social.searchUsers(q, r.user.sub); }
  @Get('profiles/:username') profile(@Req() r: any, @Param('username') u: string) { return this.social.profile(u, r.user.sub); }
  @Patch('profiles/me') updateProfile(@Req() r: any, @Body() dto: ProfileDto) { return this.social.updateProfile(r.user.sub, dto); }
  @Post('profiles/:id/follow') follow(@Req() r: any, @Param('id') id: string) { return this.social.follow(r.user.sub, id); }
  @Post('profiles/:id/unfollow') unfollow(@Req() r: any, @Param('id') id: string) { return this.social.unfollow(r.user.sub, id); }
  @Post('posts') createPost(@Req() r: any, @Body() dto: NewPostDto) { return this.social.createPost(r.user.sub, dto); }
  @Post('posts/:id/like') like(@Req() r: any, @Param('id') id: string) { return this.social.toggleLike(r.user.sub, id); }
  @Post('posts/:id/save') save(@Req() r: any, @Param('id') id: string) { return this.social.toggleSave(r.user.sub, id); }
  @Get('saved') saved(@Req() r: any) { return this.social.saved(r.user.sub); }
  @Get('posts/:id/comments') comments(@Req() r: any, @Param('id') id: string) { return this.social.comments(id, r.user.sub); }
  @Post('posts/:id/comments') comment(@Req() r: any, @Param('id') id: string, @Body() dto: CommentDto) { return this.social.comment(r.user.sub, id, dto.body); }
  @Get('stories') stories(@Req() r: any) { return this.social.stories(r.user.sub); }
  @Post('stories') story(@Req() r: any, @Body() dto: StoryDto) { return this.social.createStory(r.user.sub, dto.mediaId, dto.caption); }
  @Get('conversations') conversations(@Req() r: any) { return this.social.conversations(r.user.sub); }
  @Post('conversations/:peerId') start(@Req() r: any, @Param('peerId') id: string) { return this.social.startConversation(r.user.sub, id); }
  @Get('conversations/:id/messages') messages(@Req() r: any, @Param('id') id: string) { return this.social.messages(r.user.sub, id); }
  @Post('conversations/:id/messages') send(@Req() r: any, @Param('id') id: string, @Body() dto: MessageDto) { return this.social.sendMessage(r.user.sub, id, dto.body); }
  @Get('notifications') notifications(@Req() r: any) { return this.social.notifications(r.user.sub); }
  @Post('notifications/read') readNotifications(@Req() r: any) { return this.social.readNotifications(r.user.sub); }
  @Post('conversations/:id/read') readConversation(@Req() r: any, @Param('id') id: string) { return this.social.readConversation(r.user.sub, id); }
}
