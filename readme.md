## local dev
php -S 127.0.0.1:8000

## db change
ALTER TABLE people ADD COLUMN profile_picture MEDIUMTEXT NULL AFTER email;