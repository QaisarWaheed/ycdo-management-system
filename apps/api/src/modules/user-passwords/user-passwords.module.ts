import { Module } from '@nestjs/common';
import { UserPasswordsController } from './user-passwords.controller';
import { UserPasswordsService } from './user-passwords.service';

@Module({
  controllers: [UserPasswordsController],
  providers: [UserPasswordsService],
})
export class UserPasswordsModule {}
