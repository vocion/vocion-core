## [1.8.2](https://github.com/Vocion/vocion-core-Pro/compare/v1.8.1...v1.8.2) (2024-12-01)


### Bug Fixes

* add flex in organization profile ([3dfb3a5](https://github.com/Vocion/vocion-core-Pro/commit/3dfb3a524904bd9b4dd17aa0aa6c5ae9d9b18ceb))
* automatically close sidebar only on mobile and make Org Switcher work with Shadcn Sidebar ([eb72def](https://github.com/Vocion/vocion-core-Pro/commit/eb72def30150d5820c92860142cfa26e0b0702d1))
* avoid scroll bar in user profile component on mobile ([e372843](https://github.com/Vocion/vocion-core-Pro/commit/e372843ffda1bfd6ee82f54b20cc8fb93ab3a981))
* enhance sidebar accessibility to next.js errors and responsiveness in pricing table ([6c60d7e](https://github.com/Vocion/vocion-core-Pro/commit/6c60d7e6a43e4ddb59b1501b37b4b071ad3581bf))
* install tailwind container queries ([baa176d](https://github.com/Vocion/vocion-core-Pro/commit/baa176d36c7f2c4b6e6cd57ee09717acad70101d))
* make clerk component responsive ([c08a444](https://github.com/Vocion/vocion-core-Pro/commit/c08a44437180b3f46c058e2017588733aa458b53))
* make CTA button used in the landing page responsive ([b6db724](https://github.com/Vocion/vocion-core-Pro/commit/b6db724d7a7759c55fd2e392332194ebee832164))
* make table component responsive within sidebar ([e1ad3ef](https://github.com/Vocion/vocion-core-Pro/commit/e1ad3ef501a3e87910aef5d278fdca66ec8d535f))


### Reverts

* add back scrool bar in user profile ([75fdfbe](https://github.com/Vocion/vocion-core-Pro/commit/75fdfbe7bbfa28c522c55063ff226d648fbf439f))

## [1.8.1](https://github.com/Vocion/vocion-core-Pro/compare/v1.8.0...v1.8.1) (2024-11-23)


### Bug Fixes

* update LocaleSwitcher to force full page reload for locale changes ([bf622ad](https://github.com/Vocion/vocion-core-Pro/commit/bf622ad4cbb5baacb18191100547fe82ebe63029))

# [1.8.0](https://github.com/Vocion/vocion-core-Pro/compare/v1.7.2...v1.8.0) (2024-11-22)


### Bug Fixes

* add setRequestLocale to support static generation with i18n ([48688c7](https://github.com/Vocion/vocion-core-Pro/commit/48688c7876e48899b0a6749e89446fa1572079e9))
* replace Next.js Link with anchor tag when Stripe redirection ([97acb75](https://github.com/Vocion/vocion-core-Pro/commit/97acb7570420b7a11b82eff2c7df0125e68ba8f2))
* switch back to en/default ([ce44610](https://github.com/Vocion/vocion-core-Pro/commit/ce44610d29bf6198e7d12ee4292e89c3248ac438))


### Features

* update to next.js 15 and react 19 RC ([d33e879](https://github.com/Vocion/vocion-core-Pro/commit/d33e8790240a8754029d3e6ae7c4c554993f028d))

## [1.7.2](https://github.com/Vocion/vocion-core-Pro/compare/v1.7.1...v1.7.2) (2024-11-05)


### Bug Fixes

* add separator between UserButton and theme switcher & Locale switcher ([0f28ebe](https://github.com/Vocion/vocion-core-Pro/commit/0f28ebec928613bc7985c49332b165c715c410f1))
* add sponsor logo in user dashboard index ([02e7d82](https://github.com/Vocion/vocion-core-Pro/commit/02e7d82a5b8126332e6139800d123e77f3a558ac))
* change billing icon in AppSidebar, use Credit Card icon ([819eb7a](https://github.com/Vocion/vocion-core-Pro/commit/819eb7a9d36fefae2547b0575a1a6d079a7fa10a))
* enable eslint format in vscode ([03bbe80](https://github.com/Vocion/vocion-core-Pro/commit/03bbe801023593be71d19851cb6b0400af778408))
* implement fade support in navbar component ([fb81fe9](https://github.com/Vocion/vocion-core-Pro/commit/fb81fe96eb352975dedd1938a29338541465d612))

## [1.7.1](https://github.com/Vocion/vocion-core-Pro/compare/v1.7.0...v1.7.1) (2024-10-22)


### Bug Fixes

* add i18n for text in AppSidebar component ([0ed5b06](https://github.com/Vocion/vocion-core-Pro/commit/0ed5b06f225ed62cc9d275185ee42dc860b86f84))
* add workaround for after org creation when auth() isn't updated accordingly ([76b75d4](https://github.com/Vocion/vocion-core-Pro/commit/76b75d46cf51a64e59b1e00fff6e1926d56567a0))

# [1.7.0](https://github.com/Vocion/vocion-core-Pro/compare/v1.6.1...v1.7.0) (2024-10-22)


### Bug Fixes

* add billing link in sidebar ([6167c3f](https://github.com/Vocion/vocion-core-Pro/commit/6167c3fa940a6a5db7df756c47721092d5968a99))
* add organization switcher and user button in sidebar ([db804fa](https://github.com/Vocion/vocion-core-Pro/commit/db804fa373fd72660c47c67afecbbb5f11b47994))
* adjust font weight in TitleBar component and adjust margin in BillingPage component ([c549cd2](https://github.com/Vocion/vocion-core-Pro/commit/c549cd279c26d6213ab4ac78405999d7751052c1))


### Features

* add sidebar dependencies into the project ([e218c96](https://github.com/Vocion/vocion-core-Pro/commit/e218c96655445b0a5157369ed60984b23a1c5165))
* use shadcn cli to add sidebar-08 ([6efccad](https://github.com/Vocion/vocion-core-Pro/commit/6efccad49dea35af3e3c9eeee9668fdf0a1d8f45))


### Reverts

* back to next-intl 3.21 ([28859c2](https://github.com/Vocion/vocion-core-Pro/commit/28859c2951822009ee1bfcf9978b40e0f8523aea))

## [1.6.1](https://github.com/Vocion/vocion-core-Pro/compare/v1.6.0...v1.6.1) (2024-10-15)


### Bug Fixes

* add sticky banner in landing page ([ce1b591](https://github.com/Vocion/vocion-core-Pro/commit/ce1b5915cedf8650cfc9b94d8aaf928708938b74))

# [1.6.0](https://github.com/Vocion/vocion-core-Pro/compare/v1.5.2...v1.6.0) (2024-10-15)


### Bug Fixes

* display created at in todo table ([eea2bec](https://github.com/Vocion/vocion-core-Pro/commit/eea2bec2729c147eab836e0e240a6f623988c51c))
* implement dark mode for Clerk component ([899e12b](https://github.com/Vocion/vocion-core-Pro/commit/899e12b427fff992c4d9c71292da0954d618f14e))
* make sponsor logo dark mode compatible ([858a582](https://github.com/Vocion/vocion-core-Pro/commit/858a582c64b1f2fc7e2030432ceb3bd35ea4b3ad))
* make table responsive after adding createAt field ([de33219](https://github.com/Vocion/vocion-core-Pro/commit/de332192b2e3362330a22955a7a341497c43eb55))
* remove hydratation warning in body tag with Sentry Overlay ([2980d7a](https://github.com/Vocion/vocion-core-Pro/commit/2980d7abdef0f1512d47b0648ba3a293723103d3))
* replace Link components with anchor tags when the page redirects ([f993c49](https://github.com/Vocion/vocion-core-Pro/commit/f993c49c48004b5f754fa69c5b332333d650f8ca))
* set organization switcher max width for small screen ([36939a4](https://github.com/Vocion/vocion-core-Pro/commit/36939a49092b73e7ee9c96e5dd809d085ef70b18))


### Features

* add dark mode support ([18755de](https://github.com/Vocion/vocion-core-Pro/commit/18755dec607ef556f6b25ab7ac6e7c1b18c70744))


### Reverts

* use spotlightjs 2.4.2 instead of 2.5.0 to avoid redirection errors when using billing ([c1c5e8e](https://github.com/Vocion/vocion-core-Pro/commit/c1c5e8e75fa3fedbc3e9778f79c249e0ac5b95c8))

## [1.5.2](https://github.com/Vocion/vocion-core-Pro/compare/v1.5.1...v1.5.2) (2024-10-09)


### Bug Fixes

* add a new props isTextHidden in Logo component ([1b47a18](https://github.com/Vocion/vocion-core-Pro/commit/1b47a18048307d7a8e9e743cdd58e23f7e489635))

## [1.5.1](https://github.com/Vocion/vocion-core-Pro/compare/v1.5.0...v1.5.1) (2024-09-30)


### Bug Fixes

* remove playwright in gitignore, unused ([3609191](https://github.com/Vocion/vocion-core-Pro/commit/36091913aab1fea06ac8cd1364d966281be57e96))

# [1.5.0](https://github.com/Vocion/vocion-core-Pro/compare/v1.4.1...v1.5.0) (2024-09-30)


### Bug Fixes

* add punctuation inside i18n english json file ([2fe6e6d](https://github.com/Vocion/vocion-core-Pro/commit/2fe6e6d0e20d2b902e93b788683054f3b891d14e))


### Features

* add a storybook for Background component ([b49ea2c](https://github.com/Vocion/vocion-core-Pro/commit/b49ea2cd7c577a437c48b164b5ead2344c9bfd51))

## [1.4.1](https://github.com/Vocion/vocion-core-Pro/compare/v1.4.0...v1.4.1) (2024-09-08)


### Bug Fixes

* make NODE_ENV environment variable optional ([4af2e3c](https://github.com/Vocion/vocion-core-Pro/commit/4af2e3c104b094785f6f8e25ae25d9a0ff52d7ec))

# [1.4.0](https://github.com/Vocion/vocion-core-Pro/compare/v1.3.3...v1.4.0) (2024-07-30)


### Bug Fixes

* add test as NODE_ENV ([c1ae823](https://github.com/Vocion/vocion-core-Pro/commit/c1ae823907ce3fecb8f87603001b00dff4d22a60))
* comment NEXT_PUBLIC_APP_URL env variable ([a1e01f4](https://github.com/Vocion/vocion-core-Pro/commit/a1e01f459810fa11124fe4c41b5b8cf15b2f1a4b))
* use bigint for stripe current period end and add await for updating Stripe subscription ([d6c3942](https://github.com/Vocion/vocion-core-Pro/commit/d6c3942ed49ecc6c8a00da01dfbf4fef9c13d484))


### Features

* add primary key in todo table ([1af10b5](https://github.com/Vocion/vocion-core-Pro/commit/1af10b56a0da4eda2588f16f14c9826d0ae105c3))
* remove prefetch in billingOption ([700eb50](https://github.com/Vocion/vocion-core-Pro/commit/700eb50cebf1dbd499f9ca239380fe0bb45ecc0e))
* udpate migrations folder after adding primary key ([b5ebd35](https://github.com/Vocion/vocion-core-Pro/commit/b5ebd3503d4fd71e9ad9e516d6426d5bca3fffc0))

## [1.3.3](https://github.com/Vocion/vocion-core-Pro/compare/v1.3.2...v1.3.3) (2024-06-05)


### Bug Fixes

* add next_renew_data translation for French version ([da86be2](https://github.com/Vocion/vocion-core-Pro/commit/da86be243782c1bfc5b0f8b7835a98215b5f3794))

## [1.3.2](https://github.com/Vocion/vocion-core-Pro/compare/v1.3.1...v1.3.2) (2024-06-04)


### Bug Fixes

* automatically use Vercel environment variable for production in getBaseUrl ([38f6094](https://github.com/Vocion/vocion-core-Pro/commit/38f6094e76d4b44182838280421ef152ccbbd264))

## [1.3.1](https://github.com/Vocion/vocion-core-Pro/compare/v1.3.0...v1.3.1) (2024-06-03)


### Bug Fixes

* set BILLING_PLAN_ENV to test for unit testing ([5fda638](https://github.com/Vocion/vocion-core-Pro/commit/5fda6385f67ff91d3ccdc70c958d7f8d8fdab076))

# [1.3.0](https://github.com/Vocion/vocion-core-Pro/compare/v1.2.0...v1.3.0) (2024-06-03)


### Features

* add Demo Badge on all pages ([ca59c74](https://github.com/Vocion/vocion-core-Pro/commit/ca59c7448f7cbc3926626a8af1d177768b906823))

# [1.2.0](https://github.com/Vocion/vocion-core-Pro/compare/v1.1.0...v1.2.0) (2024-06-03)


### Features

* update to Drizzle Kit 0.22 version and update logger to support serverless/Vercel ([42c9fad](https://github.com/Vocion/vocion-core-Pro/commit/42c9fad9b54164964b986f5d013d5d2d154843b2))

# [1.1.0](https://github.com/Vocion/vocion-core-Pro/compare/v1.0.0...v1.1.0) (2024-05-20)


### Bug Fixes

* add locale in api for running Clerk middleware ([71c9e81](https://github.com/Vocion/vocion-core-Pro/commit/71c9e81047995d6ace6c6729a0d49172a5b031e0))


### Features

* add todo CRUD example and Stripe integration ([d4fff6d](https://github.com/Vocion/vocion-core-Pro/commit/d4fff6d50dd7d3956bb8d5dab5c2bf0a45cb9268))
* move Stripe webhook in unauth folder ([3e65e18](https://github.com/Vocion/vocion-core-Pro/commit/3e65e18b4d210af881a4c77a4d54dc134f58018d))
* only admin of an organization can manage billing ([be225ae](https://github.com/Vocion/vocion-core-Pro/commit/be225aeb83a6afaf81f53d00f1fee706f499c976))
* update to Storybook v8 and migrate to Vitest ([58deffb](https://github.com/Vocion/vocion-core-Pro/commit/58deffbe03d7fb633da03db143d3ac49e60dc1a5))
* vscode jest open test result view on test fails and add unauthenticatedUrl in clerk middleware ([d6cf960](https://github.com/Vocion/vocion-core-Pro/commit/d6cf96015965a664ed62c55c1ccd5dd543732558))

# 1.0.0 (2024-05-16)


### Features

* initial commit ([a1f1748](https://github.com/Vocion/vocion-core-Pro/commit/a1f1748a56ad2d8f2a7bba15b8878fcb1cb95aab))
