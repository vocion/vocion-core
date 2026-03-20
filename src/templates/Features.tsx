import { useTranslations } from 'next-intl';
import { Background } from '@/components/Background';
import { FeatureCard } from '@/features/landing/FeatureCard';
import { Section } from '@/features/landing/Section';

const AskIcon = () => (
  <svg className="stroke-primary-foreground stroke-2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <path d="M0 0h24v24H0z" stroke="none" />
    <path d="M4 21v-13a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-9l-4 4" />
    <path d="M12 11v.01M8 11v.01M16 11v.01" />
  </svg>
);

const SearchIcon = () => (
  <svg className="stroke-primary-foreground stroke-2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <path d="M0 0h24v24H0z" stroke="none" />
    <circle cx="10" cy="10" r="7" />
    <path d="M21 21l-6-6" />
  </svg>
);

const SkillsIcon = () => (
  <svg className="stroke-primary-foreground stroke-2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <path d="M0 0h24v24H0z" stroke="none" />
    <path d="M13 3l0 7l6 0l-8 11l0-7l-6 0l8-11" />
  </svg>
);

const WorkflowIcon = () => (
  <svg className="stroke-primary-foreground stroke-2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <path d="M0 0h24v24H0z" stroke="none" />
    <rect x="3" y="3" width="6" height="6" rx="1" />
    <rect x="15" y="15" width="6" height="6" rx="1" />
    <path d="M21 11v-3a2 2 0 0 0-2-2h-6l3 3m0-6l-3 3" />
    <path d="M3 13v3a2 2 0 0 0 2 2h6l-3-3m0 6l3-3" />
  </svg>
);

const GovernanceIcon = () => (
  <svg className="stroke-primary-foreground stroke-2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <path d="M0 0h24v24H0z" stroke="none" />
    <path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1-8.5 15a12 12 0 0 1-8.5-15a12 12 0 0 0 8.5-3" />
    <path d="M12 11m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0" />
    <path d="M12 12l0 2.5" />
  </svg>
);

const AgentsIcon = () => (
  <svg className="stroke-primary-foreground stroke-2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <path d="M0 0h24v24H0z" stroke="none" />
    <path d="M12 8l0 4l2 2" />
    <path d="M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5" />
  </svg>
);

export const Features = () => {
  const t = useTranslations('Features');

  return (
    <Background>
      <Section
        subtitle={t('section_subtitle')}
        title={t('section_title')}
        description={t('section_description')}
      >
        <div className="grid grid-cols-1 gap-x-3 gap-y-8 md:grid-cols-3">
          <FeatureCard icon={<AskIcon />} title={t('feature1_title')}>
            {t('feature1_description')}
          </FeatureCard>

          <FeatureCard icon={<SearchIcon />} title={t('feature2_title')}>
            {t('feature2_description')}
          </FeatureCard>

          <FeatureCard icon={<SkillsIcon />} title={t('feature3_title')}>
            {t('feature3_description')}
          </FeatureCard>

          <FeatureCard icon={<WorkflowIcon />} title={t('feature4_title')}>
            {t('feature4_description')}
          </FeatureCard>

          <FeatureCard icon={<GovernanceIcon />} title={t('feature5_title')}>
            {t('feature5_description')}
          </FeatureCard>

          <FeatureCard icon={<AgentsIcon />} title={t('feature6_title')}>
            {t('feature6_description')}
          </FeatureCard>
        </div>
      </Section>
    </Background>
  );
};
