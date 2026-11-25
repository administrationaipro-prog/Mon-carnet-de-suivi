import type React from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AppProvider, useApp } from './state';
import { Layout } from './components/Layout';
import { Loading, Notice } from './components/ui';
import { Login, Register, VerifyEmail, ForgotPassword, ResetPassword, VerifyPending, Mfa } from './pages/Auth';
import { Home } from './pages/Home';
import { Herd, AnimalForm } from './pages/Herd';
import { AnimalDetail } from './pages/AnimalDetail';
import { Weigh } from './pages/Weigh';
import { Feeding, Health, Repro, Parcels } from './pages/Journals';
import { Analytics } from './pages/Analytics';
import { Mating } from './pages/Mating';
import { Stock } from './pages/Stock';
import { Shop } from './pages/Shop';
import { Members, Collective } from './pages/Farm';
import { Account, Notifications } from './pages/Account';
import { ReviewList, ReviewDetail } from './pages/Review';
import { Admin, AdminFarmView } from './pages/Admin';
import { InstallPage } from './components/Install';
import { AuthShell } from './pages/Auth';
import { Icon } from './components/Icon';
import { VetSpace, FarmVetAccess, VerifyPage } from './pages/Vet';
import { ParasiteHome, ExamTour, ParasiteSettingsPage, CoproPage } from './pages/Parasite';

function AdminFarm() { const { id } = useParams(); return <AdminFarmView id={id!} />; }

function Routed() {
  const { me, farm, t } = useApp();
  if (!me) return <div className="center pad"><Loading /></div>;
  const publicRoutes = (
    <>
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/verifier/:number" element={me.user && me.user.email_verified ? <VerifyPage /> : <AuthShell title={t('verify_doc_title')}><VerifyPage /></AuthShell>} />
      <Route path="/installer" element={me.user && me.user.email_verified ? <InstallPage /> : <AuthShell title={`📲 ${t('install_title')}`}><InstallPage embedded /></AuthShell>} />
    </>
  );
  if (!me.user) {
    return (
      <Routes>
        {publicRoutes}
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  if (!me.user.email_verified) return <Routes>{publicRoutes}<Route path="*" element={<VerifyPending />} /></Routes>;
  if (me.user.platform_role === 'admin' && !me.mfa_verified) return <Mfa />;
  const role = me.user.platform_role;
  const needFarm = (el: React.ReactElement) => (farm ? el : <Navigate to="/" replace />);
  return (
    <Layout>
      <p className="demo-note"><Icon name="info" size={15} />{t('demo_warning')}</p>
      <Routes>
        {publicRoutes}
        <Route path="/" element={<Home />} />
        <Route path="/herd" element={needFarm(<Herd />)} />
        <Route path="/herd/new" element={needFarm(<AnimalForm />)} />
        <Route path="/herd/:id" element={needFarm(<AnimalDetail />)} />
        <Route path="/herd/:id/edit" element={needFarm(<AnimalForm />)} />
        <Route path="/weigh" element={needFarm(<Weigh />)} />
        <Route path="/analytics" element={needFarm(<Analytics />)} />
        <Route path="/feeding" element={needFarm(<Feeding />)} />
        <Route path="/stock" element={needFarm(<Stock />)} />
        <Route path="/boutique" element={needFarm(<Shop />)} />
        <Route path="/health" element={needFarm(<Health />)} />
        <Route path="/repro" element={needFarm(<Repro />)} />
        <Route path="/simulateur" element={needFarm(<Mating />)} />
        <Route path="/parcels" element={needFarm(<Parcels />)} />
        <Route path="/members" element={needFarm(<Members />)} />
        <Route path="/collective" element={farm || role === 'analyst' || role === 'admin' ? <Collective /> : <Navigate to="/" replace />} />
        <Route path="/parasitisme" element={needFarm(<ParasiteHome />)} />
        <Route path="/parasitisme/tournee" element={needFarm(<ExamTour />)} />
        <Route path="/parasitisme/seuils/:species" element={needFarm(<ParasiteSettingsPage />)} />
        <Route path="/parasitisme/copro/:id" element={needFarm(<CoproPage />)} />
        <Route path="/veterinaire" element={needFarm(<FarmVetAccess />)} />
        <Route path="/veto" element={<VetSpace />} />
        <Route path="/account" element={<Account />} />
        <Route path="/notifications" element={<Notifications />} />
        {(role === 'admin' || role === 'validator') && <Route path="/review" element={<ReviewList />} />}
        {(role === 'admin' || role === 'validator') && <Route path="/review/:id" element={<ReviewDetail />} />}
        {role === 'admin' && <Route path="/admin" element={<Admin />} />}
        {role === 'admin' && <Route path="/admin/farm/:id" element={<AdminFarm />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter><Routed /></BrowserRouter>
    </AppProvider>
  );
}
